import {
  Activity, AlertTriangle, Atom, BookOpen, Brain, Briefcase, Building2,
  Calculator, ChartColumn, ClipboardCheck, ClipboardList, Code2, Cpu,
  Database, Dna, FileStack, FileText, Flag, FolderOpen, Globe, GraduationCap,
  HeartPulse, Hospital, Layers3, Megaphone, Microscope, Pill, Radiation,
  Ribbon, ScrollText, Search, ShieldCheck, Shuffle, Snowflake, Stethoscope,
  Syringe, Target, Users, Wallet, Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

const categoryRules: [RegExp, LucideIcon][] = [
  [/注册策略|加速审批|突破性疗法|优先审评/, Target],
  [/法规|标准|合规|NMPA|FDA|EMA|IAEA|ICRP|GBZ/, ScrollText],
  [/IND|CTA|NDA|BLA|CTD|申报/, FileStack],
  [/国际注册|欧洲|澳洲|北美|亚太/, Globe],
  [/样本量|参数设定|模拟|剂量转换/, Calculator],
  [/随机|盲态|揭盲/, Shuffle],
  [/编程|SAS|宏程序|TFL|^R$/, Code2],
  [/统计|SAP|分析/, ChartColumn],
  [/数据|SDTM|ADaM|EDC|CRF|编码|锁库/, Database],
  [/RBQM|风险|KRI/, AlertTriangle],
  [/CAPA|纠正|预防|根本原因|偏差/, Wrench],
  [/培训|考核|研究者手册/, GraduationCap],
  [/稽查|核查|监查|SDV/, Search],
  [/项目管理|进度|里程碑|计划|记录|归档/, ClipboardList],
  [/中心筛选|中心评估|中心画像|可行性/, Hospital],
  [/中心启动|SSU|启动访视|立项/, Flag],
  [/受试者|入组|随访|依从性|合作客户/, Users],
  [/温控|冷链/, Snowflake],
  [/质量领域|专业领域|专项包/, Layers3],
  [/放射防护|ALARA|屏蔽|职业照射|废物|安全许可/, ShieldCheck],
  [/质量|质控|QC|SOP|GCP/, ClipboardCheck],
  [/核药|放射|辐射|照射|核素|¹⁸F|⁶⁸Ga|¹⁷⁷Lu|⁹⁰Y|²²⁵Ac|⁶⁴Cu/, Radiation],
  [/MIRD|OLINDA|EXM|器官吸收剂量/, Atom],
  [/TPS|靶区|DVH|测量|设备/, Microscope],
  [/肿瘤|肝癌|肺癌|乳腺癌|血液肿瘤|实体瘤/, Ribbon],
  [/神经|阿尔茨|帕金森|抑郁|焦虑|癫痫/, Brain],
  [/心血管|冠心病|心力衰竭|心律/, HeartPulse],
  [/代谢|内分泌|糖尿病|肥胖|甲状腺|骨代谢/, Activity],
  [/细胞|基因/, Dna],
  [/疫苗/, Syringe],
  [/药物|发药|^IP|抗感染|抗细菌|抗病毒/, Pill],
  [/器械|诊断|治疗/, Stethoscope],
  [/公司介绍|专家|服务|经验|封面/, BookOpen],
];

const departmentRules: [RegExp, LucideIcon][] = [
  [/通用|平台公共|公共/, Layers3], [/注册|法规/, ScrollText],
  [/统计|数统/, ChartColumn], [/质量|QA|QC/i, ShieldCheck],
  [/临床|SMO|项目管理/, ClipboardList], [/辐射|剂量/, Radiation],
  [/医学|器械/, Stethoscope], [/CNS|神经/i, Brain],
  [/商务|协作/, Briefcase], [/AI|IT|技术/i, Cpu],
  [/市场/, Megaphone], [/财务/, Wallet], [/综合|总经办/, Building2],
];

export function classificationIcon(name: string, kind: "company" | "department" | "category", departmentName = "", hasChildren = false): LucideIcon {
  if (kind === "company") return Building2;
  const rules = kind === "department" ? departmentRules : categoryRules;
  const exact = rules.find(([pattern]) => pattern.test(name));
  if (exact) return exact[1];
  if (kind === "category") {
    const department = departmentRules.find(([pattern]) => pattern.test(departmentName));
    if (department) return department[1];
    return hasChildren ? FolderOpen : FileText;
  }
  return Users;
}
