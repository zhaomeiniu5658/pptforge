import os, json, base64, io, zipfile
from pathlib import Path
from celery import Celery
from sqlalchemy import select
from .db import *
from .content import tool, normalize, store_asset, asset_data, audit
from .model_gateway import generate
from .importers import html_import

celery = Celery("quarkmed", broker=os.getenv("BROKER_URL", "redis://127.0.0.1:6387/0"))
celery.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    broker_transport_options={"visibility_timeout": 1800},
    task_soft_time_limit=1200,
    task_time_limit=1250,
)


class Cancelled(Exception):
    pass


def stage(db, j, text, detail=None, **data):
    db.refresh(j)
    if j.cancelled:
        raise Cancelled()
    j.stage = text
    j.updated_at = now()
    event = {"stage": text}
    if detail:
        event["detail"] = detail
    event.update(data)
    db.add(JobEvent(job_id=j.id, data=event))
    db.commit()


def ai(db, j):
    p = j.payload
    images = []
    context = ""
    target = None
    if j.kind == "template_ai":
        context = f"模板：{p['template_name']}\n遵循夸克医药视觉规范，保留提供的医学文字与数据。\n"
        if p.get("document"):
            context += "当前页面草稿：" + json.dumps(p["document"], ensure_ascii=False) + "\n"
    else:
        bk = db.get(Booklet, p["booklet_id"])
        pr = db.get(Project, bk.project_id)
        context = f"项目：{pr.name}\n背景：{pr.description}\n分册：{bk.title}\n规范：{bk.instructions}\n"
    if p.get("page_id"):
        context += (
            "现有文档："
            + json.dumps(
                db.get(Revision, p["base_revision_id"]).document, ensure_ascii=False
            )
            + "\n"
        )
    if p.get("parent_job_id"):
        parent = db.get(Job, p["parent_job_id"])
        context += (
            "上一个候选："
            + json.dumps(parent.result.get("documents", []), ensure_ascii=False)
            + "\n"
        )
    if p.get("asset_id"):
        a = db.get(Asset, p["asset_id"])
        if not a.media_type.startswith("image/"):
            raise ValueError("AI 参考文件必须是图片，HTML 请使用导入")
        stage(db, j, "读取参考图片", f"正在读取 {a.name}，作为页面还原的视觉参考。")
        images = [asset_data(a)]
        target = images[0].split(",", 1)[1]
        if os.getenv("CALQUE_ENABLED") == "true":
            stage(db, j, "分析图片", "正在识别截图中的布局、颜色、边界和文字区域。")
            try:
                context += (
                    "视觉结构："
                    + json.dumps(
                        tool("/internal/analyze", {"image": target}, 180)["spec"],
                        ensure_ascii=False,
                    )[:25000]
                )
            except Exception:
                context += "\n视觉结构分析不可用，请直接分析参考图片。"
                stage(db, j, "跳过结构分析", "视觉结构分析服务不可用，本次直接把参考图交给模型理解。")
    generate_page = generate
    if p.get("model_id"):
        from .model_profiles import load_model
        config = load_model(p["model_id"], bool(images))
        generate_page = lambda prompt, pictures: generate(prompt, pictures, config=config)
        stage(db, j, "选择模型", f"使用 {p.get('model_label') or p.get('model_id')} 生成候选页面。")
    else:
        stage(db, j, "选择模型", "使用当前默认模型生成候选页面。")
    stage(db, j, "生成页面", "正在组织项目上下文、模板规范和设计需求，并调用模型输出 HTML。")
    doc = normalize({"html": generate_page(context + p["prompt"], images)})
    stage(db, j, "整理 HTML", "正在清理模型输出，转换为平台可编辑的页面文档。")
    best = None
    best_score = -1
    rounds = []
    warnings = []
    width, height = 1280, 900
    if target:
        from PIL import Image

        im = Image.open(io.BytesIO(base64.b64decode(target)))
        width, height = im.size
        if not 320 <= width <= 2560 or not 200 <= height <= 10000:
            raise ValueError("截图尺寸需为宽 320–2560、高 200–10000 像素")
    for ix in range(3 if target else 1):
        stage(db, j, "检查效果" + f"（{ix + 1}）", "正在用 Chromium 渲染候选页面并检查可交互状态。")
        render = tool(
            "/internal/render", {"document": doc, "width": width, "height": height}
        )
        comparison = (
            tool("/internal/compare", {"target": target, "actual": render["png"]})
            if target
            else {"score": 1}
        )
        score = comparison["score"]
        stage(db, j, "对比参考图" + f"（{ix + 1}）",
              f"当前视觉相似度约 {score:.0%}，正在保留本轮可用结果。")
        rounds.append(
            {
                "round": ix + 1,
                "score": score,
                "metrics": render["metrics"],
                "errors": render["errors"],
                "interactions": render.get("interactionReport", {}),
                "dimensionMismatch": comparison.get("dimensionMismatch", False),
            }
        )
        if score > best_score:
            best, best_score = doc, score
        j.result = {
            "title": p["prompt"][:40],
            "documents": [best],
            "rounds": rounds,
            "score": best_score,
            "adopted": False,
        }
        db.commit()
        if not target or score >= 0.94 or ix == 2:
            break
        stage(db, j, "优化页面" + f"（{ix + 1}）", "正在把渲染差异反馈给模型，修正布局、尺寸、颜色和文字位置。")
        prompt = (
            context
            + p["prompt"]
            + "\n当前 HTML："
            + json.dumps(doc, ensure_ascii=False)
            + "\n比较指标："
            + json.dumps(rounds[-1], ensure_ascii=False)
            + "\n第一张为目标，第二张为当前渲染。修正布局、尺寸、文字与颜色，输出完整 HTML。"
        )
        try:
            doc = normalize(
                {
                    "html": generate_page(
                        prompt, images + ["data:image/png;base64," + render["png"]]
                    )
                }
            )
        except Exception:
            warnings.append("后续优化未完成，已保留前面检查得到的最佳候选。")
            break
    return {
        "title": p["prompt"][:40],
        "documents": [best],
        "rounds": rounds,
        "score": best_score,
        "warnings": warnings,
        "adopted": False,
    }


@celery.task(name="quark.execute")
def execute(id):
    with SessionLocal() as db:
        j = db.get(Job, id)
        if not j or j.cancelled or j.status == "succeeded":
            return
        j.status = "running"
        j.attempts += 1
        db.commit()
        try:
            stage(db, j, "开始处理")
            p = j.payload
            if j.kind in ("ai", "template_ai"):
                result = ai(db, j)
            elif j.kind in ("html_import", "pptx_import", "template_import"):
                a = db.get(Asset, p["asset_id"])
                data = Path(a.path).read_bytes()
                if a.name.lower().endswith(".pptx"):
                    from .pptx_converter import convert

                    stage(db, j, "解析并渲染 PPTX")
                    docs, diagnostics = convert(data)
                    for ix, d in enumerate(docs):
                        stage(db, j, f"检查转换效果（{ix + 1}/{len(docs)}）")
                        size = d["sourceSize"]
                        r = tool(
                            "/internal/render",
                            {
                                "document": d,
                                "width": max(320, min(2560, size["width"])),
                                "height": max(200, min(10000, size["height"])),
                            },
                        )
                        ref = next(
                            x["referenceImage"]
                            for x in d["sourceReferences"]
                            if "referenceImage" in x
                        )
                        diff = tool(
                            "/internal/compare",
                            {"target": ref.split(",", 1)[1], "actual": r["png"]},
                        )
                        note = {
                            "source": "pptx",
                            "severity": "error" if diff["score"] < 0.5 else "warning",
                            "message": f"第 {ix + 1} 页视觉相似度 {diff['score']:.0%}，请对照原稿检查",
                            "score": diff["score"],
                        }
                        d["diagnostics"].append(note)
                        diagnostics.append(note)
                else:
                    stage(db, j, "归档 HTML 资源")
                    docs = html_import(data, a.name,
                        archive_remote=j.kind == "template_import",
                        on_page=lambda ix, total: stage(db, j, f"归档页面与资源（{ix + 1}/{total}）"))
                    diagnostics = [
                        {**d, "message": f"第 {ix + 1} 页：{d['message']}"}
                        for ix, doc in enumerate(docs) for d in doc.get("diagnostics", [])
                    ]
                if j.kind in ("pptx_import", "template_import"):
                    stage(db, j, "保存待检查模板")
                    t = Template(
                        name=(p.get("template_name") or Path(a.name).stem)[:200],
                        category_id=p["category_id"],
                        department_id=p.get("department_id"),
                        shared=p.get("shared", True),
                        active=False,
                    )
                    db.add(t)
                    db.flush()
                    v = TemplateVersion(
                        template_id=t.id,
                        documents=docs,
                        diagnostics=diagnostics,
                        source_asset_id=a.id,
                    )
                    db.add(v)
                    db.flush()
                    t.current_version_id = v.id
                    audit(db, j.owner_id, "template.import", t.id, {"job_id": j.id, "page_count": len(docs)})
                    result = {
                        "template_id": t.id,
                        "page_count": len(docs),
                        "diagnostics": diagnostics,
                    }
                else:
                    result = {
                        "documents": docs,
                        "title": Path(a.name).stem,
                        "adopted": False,
                    }
            elif j.kind == "export":
                stage(db, j, "编排并归档页面")
                pages = [
                    {
                        "title": m["booklet_title"] + " · " + m["title"],
                        "document": db.get(Revision, m["revision_id"]).document,
                    }
                    for m in p["manifest"]
                ]
                compiled = tool(
                    "/internal/compile",
                    {
                        "pages": pages,
                        "options": {"title": p["title"], "draft": p["draft"]},
                    },
                )
                if any(x.get("severity") == "error" for x in compiled["diagnostics"]):
                    raise ValueError("存在未归档资源，导出中止。请先修复页面诊断。")
                data = compiled["html"].encode()
                ext = p["format"]
                if ext == "zip":
                    from .exports import bundle

                    individual = [
                        tool(
                            "/internal/compile",
                            {"pages": [page], "options": {"navigation": False}},
                        )["html"]
                        for page in pages
                    ]
                    data = bundle(compiled["html"], individual, p)
                stage(db, j, "保存导出文件")
                a = store_asset(
                    db,
                    j.owner_id,
                    p["title"][:100] + "." + ext,
                    data,
                    "text/html" if ext == "html" else "application/zip",
                    j.project_id,
                )
                db.add(
                    Export(
                        project_id=j.project_id,
                        actor_id=j.owner_id,
                        manifest=p["manifest"],
                        asset_id=a.id,
                        draft=p["draft"],
                    )
                )
                audit(
                    db,
                    j.owner_id,
                    "project.export",
                    j.project_id,
                    {"asset_id": a.id, "draft": p["draft"]},
                )
                result = {
                    "asset_id": a.id,
                    "url": "/api/assets/" + a.id,
                    "name": a.name,
                }
            else:
                raise ValueError("未知任务类型")
            # Lock on completion so cancellation cannot race a successful result commit.
            db.refresh(j, with_for_update=True)
            if j.cancelled:
                raise Cancelled()
            j.result = result
            j.status = "succeeded"
            j.stage = "处理完成"
            j.updated_at = now()
            db.add(JobEvent(job_id=j.id, data={"stage": "处理完成", "detail": "候选页面已生成，可以预览后采用到草稿。"}))
            db.commit()
        except Cancelled:
            db.rollback()
            j = db.get(Job, id)
            j.status = "cancelled"
            j.stage = "已取消"
            db.add(JobEvent(job_id=j.id, data={"stage": "已取消", "detail": "任务已停止，未采用任何新结果。"}))
            db.commit()
        except Exception as e:
            db.rollback()
            j = db.get(Job, id)
            if not j.cancelled:
                j.status = "failed"
                j.stage = "处理失败"
                j.error = (
                    str(e)
                    if isinstance(e, (ValueError, UnicodeError, zipfile.BadZipFile))
                    else "处理失败："
                    + type(e).__name__
                    + "。请检查模型、渲染服务或 Worker 日志。"
                )[:1500]
                db.add(JobEvent(job_id=j.id, data={"stage": "处理失败", "detail": j.error}))
            j.updated_at = now()
            db.commit()
            import logging

            logging.exception("Job %s failed", id)
