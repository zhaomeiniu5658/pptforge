import { useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { Modal } from "./components";

export function ProjectDatePicker({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [month, setMonth] = useState(new Date());
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = new Date(year, monthIndex, 1).getDay();
  const days = new Date(year, monthIndex + 1, 0).getDate();
  const valid = !draft || ((!min || draft >= min) && (!max || draft <= max));
  function close() {
    setOpen(false);
    trigger.current?.focus();
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={"pm-date-trigger" + (!value ? " pm-date-placeholder" : "")}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setDraft(value);
          const initial = value || min || max;
          const date = initial ? new Date(initial + "T00:00:00") : new Date();
          setMonth(new Date(date.getFullYear(), date.getMonth(), 1));
          setOpen(true);
        }}
      >
        {value ? value.replaceAll("-", "/") : "年/月/日"}
        <CalendarDays size={14} />
      </button>
      {open && (
        <Modal title={label} onClose={close}>
          <div className="modal-body">
            <div className="pm-calendar">
              <div className="pm-calendar-month">
                <button
                  type="button"
                  aria-label="上个月"
                  onClick={() => setMonth(new Date(year, monthIndex - 1, 1))}
                >
                  <ChevronLeft size={16} />
                </button>
                <strong aria-live="polite">
                  {year}年{monthIndex + 1}月
                </strong>
                <button
                  type="button"
                  aria-label="下个月"
                  onClick={() => setMonth(new Date(year, monthIndex + 1, 1))}
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              <div className="pm-calendar-grid">
                {["日", "一", "二", "三", "四", "五", "六"].map((d) => (
                  <span key={d}>{d}</span>
                ))}
                {Array.from({ length: firstDay }, (_, i) => (
                  <span key={"blank-" + i} />
                ))}
                {Array.from({ length: days }, (_, i) => {
                  const date = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
                  return (
                    <button
                      key={date}
                      type="button"
                      aria-label={date}
                      aria-pressed={draft === date}
                      disabled={!!((min && date < min) || (max && date > max))}
                      className={draft === date ? "primary" : ""}
                      onClick={() => setDraft(date)}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <p className="muted" aria-live="polite">
                {draft ? `已选：${draft}` : "未选择日期"}
              </p>
            </div>
          </div>
          <footer className="modal-footer">
            <button type="button" onClick={() => setDraft("")}>
              清空
            </button>
            <button type="button" onClick={close}>
              取消
            </button>
            <button
              type="button"
              className="primary"
              disabled={!valid}
              onClick={() => {
                onChange(draft);
                close();
              }}
            >
              确认
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
