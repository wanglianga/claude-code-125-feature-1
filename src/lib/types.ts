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
  draft: '草稿', confirmed: '待缴费', paid: '已缴费', hold: '已挂起', cancelled: '已取消', review: '待复核',
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
  // 补测与生产锁定
  need_makeup: '待补测', referenced: '风险占位', scheduled: '已安排补测',
  measured: '班主任已确认', locked: '尺码已锁定', prelocked: '已按参考预锁', deferred: '已延后',
  candidate: '候选时段', adjusted: '人工已调整',
  placeholder: '风险占位',
  acknowledged: '已知晓',
  makeup_overdue: '补测逾期', sample_shortage: '样衣不足', teacher_timeout: '班主任超时',
  parent_timeout: '家长超时未确认', deadline_open: '截止日未闭环', size_mismatch: '两次确认不一致',
};

export const EXCEPTION_LABELS: Record<string, string> = {
  makeup_overdue: '补测逾期', sample_shortage: '样衣不足', teacher_timeout: '班主任超时',
  parent_timeout: '家长超时未确认', deadline_open: '截止日未闭环', size_mismatch: '两次确认不一致',
};

export function badgeClass(status: string) {
  if (['paid', 'signed', 'approved', 'resolved', 'arrived', 'completed', 'produced', 'done', 'active', 'locked', 'prelocked'].includes(status)) return 'green';
  if (['hold', 'wrong_claim', 'missing', 'rejected', 'cancelled', 'transferred', 'overdue', 'shipped', 'review', 'placeholder', 'deferred', 'referenced', 'makeup_overdue', 'sample_shortage', 'deadline_open', 'size_mismatch', 'parent_timeout', 'teacher_timeout'].includes(status)) return status === 'shipped' ? 'amber' : 'red';
  if (['confirmed', 'open', 'requested', 'in_production', 'part_shipped', 'issued', 'processing', 'pending', 'planned', 'returned', 'reshipped', 'candidate', 'scheduled', 'measured', 'need_makeup', 'acknowledged', 'adjusted'].includes(status)) return 'amber';
  if (['draft', 'graduated'].includes(status)) return 'gray';
  return 'blue';
}
