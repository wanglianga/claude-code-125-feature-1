export const ROLE_LABELS: Record<string, string> = {
  admin: '系统管理员',
  general_affairs: '学校总务',
  head_teacher: '班主任',
  parent: '家长',
  supplier: '供应商',
  factory: '工厂',
  after_sales: '售后客服',
};

export interface SessionUserT {
  id: number;
  username: string;
  real_name: string;
  role: keyof typeof ROLE_LABELS | string;
  campus_id: number | null;
  supplier_id: number | null;
}

export const STATUS_LABELS: Record<string, string> = {
  draft: '草稿', confirmed: '待缴费', paid: '已缴费', hold: '已挂起', cancelled: '已取消',
  active: '在校', transferred: '已转学', graduated: '已毕业',
  open: '待处理', processing: '处理中', resolved: '已解决', rejected: '已驳回',
  planned: '已计划', in_production: '生产中', produced: '已完工', part_shipped: '部分发货', completed: '已完成',
  shipped: '运输中', arrived: '已到校',
  issued: '已发放', signed: '已签收', wrong_claim: '错领', missing: '缺件',
  pending: '待审批', approved: '已批准', rejected_b: '已驳回',
  requested: '待处理', returned: '已寄回', reshipped: '已重发', done: '完成',
  regular: '常规发放', supplementary: '补领场',
  annual: '年度统一采购', makeup: '毕业班补订',
  in_progress_d: '进行中',
};

// 补测/生产锁定相关状态
Object.assign(STATUS_LABELS, {
  risk_placeholder: '风险占位', review: '待复核', prelocked: '参考预锁', locked: '已锁定', none: '未锁定',
  candidate: '候选时段', scheduled: '已排期', completed: '已完成', overdue: '已逾期', cancelled: '已取消',
  pending_ref: '待参考尺码', waiting: '待补测', measured: '已测待确认', teacher_done: '待家长确认',
  closed: '已闭环', postponed: '已延后', parent_timeout: '家长超时', sample_shortage: '样衣不足',
  makeup_overdue: '补测逾期', makeup: '补测',
  open_exc: '未处理', resolved_exc: '已处理',
});

export function badgeClass(status: string) {
  if (['paid', 'signed', 'approved', 'resolved', 'arrived', 'completed', 'produced', 'done', 'active', 'locked', 'closed'].includes(status)) return 'green';
  if (['hold', 'wrong_claim', 'missing', 'rejected', 'cancelled', 'transferred', 'overdue', 'shipped', 'review', 'parent_timeout', 'sample_shortage'].includes(status)) return status === 'shipped' ? 'amber' : 'red';
  if (['confirmed', 'open', 'requested', 'in_production', 'part_shipped', 'issued', 'processing', 'pending', 'planned', 'returned', 'reshipped', 'risk_placeholder', 'prelocked', 'candidate', 'scheduled', 'waiting', 'measured', 'teacher_done'].includes(status)) return 'amber';
  if (['draft', 'graduated', 'postponed', 'pending_ref'].includes(status)) return 'gray';
  return 'blue';
}
