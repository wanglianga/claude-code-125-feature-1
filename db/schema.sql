-- 校园校服订购尺码试穿与售后换码平台 数据库结构
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE IF NOT EXISTS campuses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  contact VARCHAR(100),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS grades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  campus_id INT NOT NULL,
  name VARCHAR(50) NOT NULL,
  graduation_year INT NULL,
  INDEX (campus_id),
  CONSTRAINT fk_grades_campus FOREIGN KEY (campus_id) REFERENCES campuses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(60) NOT NULL UNIQUE,
  password_hash VARCHAR(200) NOT NULL,
  salt VARCHAR(64) NOT NULL,
  real_name VARCHAR(60) NOT NULL,
  role ENUM('admin','general_affairs','head_teacher','parent','supplier','factory','after_sales') NOT NULL,
  campus_id INT NULL,
  supplier_id INT NULL,
  phone VARCHAR(30),
  CONSTRAINT fk_users_campus FOREIGN KEY (campus_id) REFERENCES campuses(id),
  CONSTRAINT fk_users_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS classes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  grade_id INT NOT NULL,
  name VARCHAR(50) NOT NULL,
  teacher_user_id INT NULL,
  INDEX (grade_id),
  CONSTRAINT fk_classes_grade FOREIGN KEY (grade_id) REFERENCES grades(id),
  CONSTRAINT fk_classes_teacher FOREIGN KEY (teacher_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 学生（家长端维护身高体重/常穿尺码/特殊版型；转学留痕）
CREATE TABLE IF NOT EXISTS students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_no VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(60) NOT NULL,
  campus_id INT NOT NULL,
  grade_id INT NOT NULL,
  class_id INT NOT NULL,
  parent_user_id INT NULL,
  status ENUM('active','transferred','graduated') NOT NULL DEFAULT 'active',
  transferred_at DATETIME NULL,
  height_cm DECIMAL(5,1) NULL,
  weight_kg DECIMAL(5,1) NULL,
  usual_size VARCHAR(20) NULL,
  special_fit TINYINT(1) NOT NULL DEFAULT 0,
  special_fit_note VARCHAR(200),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (class_id), INDEX (parent_user_id),
  CONSTRAINT fk_students_campus FOREIGN KEY (campus_id) REFERENCES campuses(id),
  CONSTRAINT fk_students_grade FOREIGN KEY (grade_id) REFERENCES grades(id),
  CONSTRAINT fk_students_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_students_parent FOREIGN KEY (parent_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 贫困生减免
CREATE TABLE IF NOT EXISTS subsidies (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NOT NULL,
  ratio DECIMAL(4,2) NOT NULL COMMENT '减免比例 0~1',
  reason VARCHAR(200),
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  approved_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_subsidy_student (student_id),
  CONSTRAINT fk_subsidy_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_subsidy_approver FOREIGN KEY (approved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 订购计划（多校区统一采购：plan_campuses 多条；毕业班补订 kind=makeup）
CREATE TABLE IF NOT EXISTS plans (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  kind ENUM('annual','makeup') NOT NULL DEFAULT 'annual',
  academic_year VARCHAR(20) NOT NULL,
  season VARCHAR(20) NOT NULL,
  supplier_id INT NOT NULL,
  status ENUM('draft','open','closed') NOT NULL DEFAULT 'draft',
  order_deadline DATETIME NOT NULL,
  production_deadline DATETIME NULL COMMENT '班级生产锁定截止日（仍未闭环转总务预锁/延后）',
  fitting_date DATE NULL,
  note VARCHAR(300),
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_plans_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_plans_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plan_campuses (
  plan_id INT NOT NULL,
  campus_id INT NOT NULL,
  PRIMARY KEY (plan_id, campus_id),
  CONSTRAINT fk_pc_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_pc_campus FOREIGN KEY (campus_id) REFERENCES campuses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plan_grades (
  plan_id INT NOT NULL,
  grade_id INT NOT NULL,
  PRIMARY KEY (plan_id, grade_id),
  CONSTRAINT fk_pg_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  CONSTRAINT fk_pg_grade FOREIGN KEY (grade_id) REFERENCES grades(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 计划品类：季节套装/运动服/礼服/增购件 × 上衣/裤子/裙装/外套/鞋
CREATE TABLE IF NOT EXISTS plan_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  suit_kind ENUM('season_set','sportswear','formal','extra') NOT NULL,
  garment_type ENUM('top','pants','skirt','coat','shoes') NOT NULL,
  price DECIMAL(8,2) NOT NULL DEFAULT 0,
  required TINYINT(1) NOT NULL DEFAULT 1,
  INDEX (plan_id),
  CONSTRAINT fk_pi_plan FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 试穿时段（班主任按时段组织；kind=makeup 为集中试穿后的补测时段）
CREATE TABLE IF NOT EXISTS fitting_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  class_id INT NOT NULL,
  kind ENUM('regular','makeup') NOT NULL DEFAULT 'regular',
  makeup_session_id INT NULL COMMENT '补测时段关联的补测安排',
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  location VARCHAR(100) NOT NULL,
  organizer_user_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (plan_id), INDEX (class_id),
  CONSTRAINT fk_fs_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_fs_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_fs_organizer FOREIGN KEY (organizer_user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 试穿记录（工作人员登记五类尺码建议）
CREATE TABLE IF NOT EXISTS fitting_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  session_id INT NOT NULL,
  student_id INT NOT NULL,
  staff_name VARCHAR(60) NOT NULL,
  size_top VARCHAR(20) NULL,
  size_pants VARCHAR(20) NULL,
  size_skirt VARCHAR(20) NULL,
  size_coat VARCHAR(20) NULL,
  size_shoes VARCHAR(20) NULL,
  special_note VARCHAR(300),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_session_student (session_id, student_id),
  CONSTRAINT fk_fr_session FOREIGN KEY (session_id) REFERENCES fitting_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_fr_student FOREIGN KEY (student_id) REFERENCES students(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 订单（hold：迟缴费/转学等暂缓，供应商不可投产）
-- size_lock: none 正式尺码可投产；risk_placeholder 漏测风险占位（仅参考尺码，不计正式数量）；
--            review 班主任/家长两次确认不一致待复核；prelocked 总务批准按参考尺码预锁；locked 已闭环正式锁定
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(40) NOT NULL UNIQUE,
  plan_id INT NOT NULL,
  student_id INT NOT NULL,
  class_id INT NOT NULL,
  status ENUM('draft','confirmed','paid','hold','cancelled') NOT NULL DEFAULT 'draft',
  hold_reason VARCHAR(200),
  size_lock ENUM('none','risk_placeholder','review','prelocked','locked') NOT NULL DEFAULT 'none',
  risk_placeholder TINYINT(1) NOT NULL DEFAULT 0,
  payable_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  subsidy_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  due_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  paid_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  confirmed_at DATETIME NULL,
  paid_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  parent_note VARCHAR(300),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (plan_id), INDEX (student_id), INDEX (class_id),
  CONSTRAINT fk_orders_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_orders_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_orders_class FOREIGN KEY (class_id) REFERENCES classes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  plan_item_id INT NOT NULL,
  garment_type ENUM('top','pants','skirt','coat','shoes') NOT NULL,
  name VARCHAR(100) NOT NULL,
  size VARCHAR(20) NOT NULL,
  price DECIMAL(8,2) NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  is_extra TINYINT(1) NOT NULL DEFAULT 0,
  shipped_qty INT NOT NULL DEFAULT 0,
  signed_qty INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (order_id), INDEX (plan_item_id),
  CONSTRAINT fk_oi_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  CONSTRAINT fk_oi_pi FOREIGN KEY (plan_item_id) REFERENCES plan_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 工厂生产批次
CREATE TABLE IF NOT EXISTS production_batches (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_no VARCHAR(40) NOT NULL UNIQUE,
  plan_id INT NOT NULL,
  supplier_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  status ENUM('planned','in_production','produced','part_shipped','completed') NOT NULL DEFAULT 'planned',
  expected_arrival DATE NULL,
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (plan_id),
  CONSTRAINT fk_pb_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_pb_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_pb_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS batch_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_id INT NOT NULL,
  plan_item_id INT NOT NULL,
  size VARCHAR(20) NOT NULL,
  qty INT NOT NULL,
  produced_qty INT NOT NULL DEFAULT 0,
  INDEX (batch_id),
  CONSTRAINT fk_bi_batch FOREIGN KEY (batch_id) REFERENCES production_batches(id) ON DELETE CASCADE,
  CONSTRAINT fk_bi_pi FOREIGN KEY (plan_item_id) REFERENCES plan_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 批次明细分配到具体学生的订单明细（支撑按学生追踪生产进度）
CREATE TABLE IF NOT EXISTS batch_allocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  batch_item_id INT NOT NULL,
  order_item_id INT NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_bi_oi (batch_item_id, order_item_id),
  CONSTRAINT fk_ba_bi FOREIGN KEY (batch_item_id) REFERENCES batch_items(id) ON DELETE CASCADE,
  CONSTRAINT fk_ba_oi FOREIGN KEY (order_item_id) REFERENCES order_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 供应商分批发货
CREATE TABLE IF NOT EXISTS shipments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shipment_no VARCHAR(40) NOT NULL UNIQUE,
  batch_id INT NOT NULL,
  carrier VARCHAR(80),
  tracking_no VARCHAR(80),
  shipped_at DATETIME NOT NULL,
  expected_arrival DATE NOT NULL,
  status ENUM('shipped','arrived') NOT NULL DEFAULT 'shipped',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (batch_id),
  CONSTRAINT fk_sh_batch FOREIGN KEY (batch_id) REFERENCES production_batches(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shipment_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shipment_id INT NOT NULL,
  order_item_id INT NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  arrived_qty INT NOT NULL DEFAULT 0 COMMENT '实际到校数量，工厂漏发时小于 qty',
  missing_qty INT NOT NULL DEFAULT 0,
  INDEX (shipment_id), INDEX (order_item_id),
  CONSTRAINT fk_sl_shipment FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE CASCADE,
  CONSTRAINT fk_sl_oi FOREIGN KEY (order_item_id) REFERENCES order_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 到校分批发放与补领安排
CREATE TABLE IF NOT EXISTS distributions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  class_id INT NOT NULL,
  campus_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  kind ENUM('regular','supplementary') NOT NULL DEFAULT 'regular',
  scheduled_at DATETIME NOT NULL,
  location VARCHAR(100) NOT NULL,
  status ENUM('planned','in_progress','done') NOT NULL DEFAULT 'planned',
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (plan_id), INDEX (class_id),
  CONSTRAINT fk_dist_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_dist_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_dist_campus FOREIGN KEY (campus_id) REFERENCES campuses(id),
  CONSTRAINT fk_dist_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 签收记录（漏发 missing / 班级错领 wrong_claim 留痕，handled 标记已闭环）
CREATE TABLE IF NOT EXISTS receipts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  distribution_id INT NOT NULL,
  order_item_id INT NOT NULL,
  student_id INT NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  status ENUM('issued','signed','wrong_claim','missing') NOT NULL DEFAULT 'issued',
  claimant_student_id INT NULL,
  signed_by VARCHAR(60),
  reason VARCHAR(200),
  handled TINYINT(1) NOT NULL DEFAULT 0,
  issued_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  signed_at DATETIME NULL,
  UNIQUE KEY uq_dist_oi (distribution_id, order_item_id),
  INDEX (student_id),
  CONSTRAINT fk_rc_dist FOREIGN KEY (distribution_id) REFERENCES distributions(id) ON DELETE CASCADE,
  CONSTRAINT fk_rc_oi FOREIGN KEY (order_item_id) REFERENCES order_items(id),
  CONSTRAINT fk_rc_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_rc_claimant FOREIGN KEY (claimant_student_id) REFERENCES students(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 售后工单：换码/补发/退款/投诉/转学取消/错领，原因覆盖全部异常场景
CREATE TABLE IF NOT EXISTS aftersales_cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_no VARCHAR(40) NOT NULL UNIQUE,
  student_id INT NOT NULL,
  order_id INT NULL,
  order_item_id INT NULL,
  type ENUM('exchange','resend','refund','complaint','transfer_cancel','wrong_claim') NOT NULL,
  reason ENUM('growth','fitting_deviation','factory_missing','wrong_class_claim','allergy','late_payment','transfer','other') NOT NULL,
  status ENUM('open','processing','resolved','rejected') NOT NULL DEFAULT 'open',
  priority ENUM('normal','high') NOT NULL DEFAULT 'normal',
  description VARCHAR(500),
  resolution VARCHAR(500),
  created_by INT NULL,
  assigned_to INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  INDEX (student_id), INDEX (status),
  CONSTRAINT fk_case_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_case_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_case_oi FOREIGN KEY (order_item_id) REFERENCES order_items(id),
  CONSTRAINT fk_case_creator FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT fk_case_assignee FOREIGN KEY (assigned_to) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 换码（成长过快/试穿偏差等）
CREATE TABLE IF NOT EXISTS exchange_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  order_item_id INT NOT NULL,
  old_size VARCHAR(20) NOT NULL,
  new_size VARCHAR(20) NOT NULL,
  status ENUM('requested','returned','reshipped','done','rejected') NOT NULL DEFAULT 'requested',
  return_tracking VARCHAR(80),
  reship_tracking VARCHAR(80),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (case_id),
  CONSTRAINT fk_ex_case FOREIGN KEY (case_id) REFERENCES aftersales_cases(id),
  CONSTRAINT fk_ex_oi FOREIGN KEY (order_item_id) REFERENCES order_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 补发（工厂漏发/错领找回失败等）
CREATE TABLE IF NOT EXISTS resend_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  order_item_id INT NULL,
  plan_item_id INT NULL,
  size VARCHAR(20),
  qty INT NOT NULL DEFAULT 1,
  status ENUM('requested','shipped','arrived','done') NOT NULL DEFAULT 'requested',
  tracking_no VARCHAR(80),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (case_id),
  CONSTRAINT fk_rr_case FOREIGN KEY (case_id) REFERENCES aftersales_cases(id),
  CONSTRAINT fk_rr_oi FOREIGN KEY (order_item_id) REFERENCES order_items(id),
  CONSTRAINT fk_rr_pi FOREIGN KEY (plan_item_id) REFERENCES plan_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 退款（转学/迟缴费取消/过敏等）
CREATE TABLE IF NOT EXISTS refund_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  reason VARCHAR(200),
  status ENUM('requested','approved','refunded','rejected') NOT NULL DEFAULT 'requested',
  refunded_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (case_id),
  CONSTRAINT fk_ref_case FOREIGN KEY (case_id) REFERENCES aftersales_cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 供应商考核
CREATE TABLE IF NOT EXISTS supplier_assessments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  plan_id INT NULL,
  period VARCHAR(20) NOT NULL,
  score DECIMAL(5,2) NOT NULL,
  missing_count INT NOT NULL DEFAULT 0,
  delay_count INT NOT NULL DEFAULT 0,
  allergy_count INT NOT NULL DEFAULT 0,
  exchange_count INT NOT NULL DEFAULT 0,
  note VARCHAR(500),
  assessed_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (supplier_id),
  CONSTRAINT fk_sa_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_sa_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_sa_user FOREIGN KEY (assessed_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===================== 集中试穿漏测：补测与生产锁定 =====================

-- 班主任空闲时间（生成补测候选时段的约束之一；按校区/老师维护）
CREATE TABLE IF NOT EXISTS teacher_availabilities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_user_id INT NOT NULL,
  campus_id INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  note VARCHAR(200),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (teacher_user_id), INDEX (campus_id),
  CONSTRAINT fk_ta_teacher FOREIGN KEY (teacher_user_id) REFERENCES users(id),
  CONSTRAINT fk_ta_campus FOREIGN KEY (campus_id) REFERENCES campuses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 供应商可用尺码样衣库存（校区 × 尺码；补测候选时段只能安排在库存可覆盖的尺码集合上）
CREATE TABLE IF NOT EXISTS sample_stock (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  campus_id INT NOT NULL,
  size VARCHAR(20) NOT NULL,
  qty INT NOT NULL DEFAULT 0,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sample (supplier_id, campus_id, size),
  CONSTRAINT fk_ss_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_ss_campus FOREIGN KEY (campus_id) REFERENCES campuses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 补测安排（系统按班级/校区/样衣/班主任空闲生成候选，总务或班主任拍板；多班竞争按优先级排序）
CREATE TABLE IF NOT EXISTS makeup_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  class_id INT NOT NULL,
  campus_id INT NOT NULL,
  supplier_id INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  location VARCHAR(100) NOT NULL,
  teacher_user_id INT NOT NULL,
  priority_score INT NOT NULL DEFAULT 0 COMMENT '生产截止日紧迫度+首次订购+已确认人数综合优先级，越大越优先',
  status ENUM('candidate','scheduled','completed','overdue','cancelled') NOT NULL DEFAULT 'candidate',
  adjusted_by INT NULL COMMENT '人工调整人',
  adjust_reason VARCHAR(300) COMMENT '人工调整原因（必须留痕）',
  created_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX (plan_id), INDEX (class_id), INDEX (status),
  CONSTRAINT fk_ms_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_ms_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_ms_campus FOREIGN KEY (campus_id) REFERENCES campuses(id),
  CONSTRAINT fk_ms_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_ms_teacher FOREIGN KEY (teacher_user_id) REFERENCES users(id),
  CONSTRAINT fk_ms_adjuster FOREIGN KEY (adjusted_by) REFERENCES users(id),
  CONSTRAINT fk_ms_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 补测学生明细（漏测学生：参考尺码→实测→班主任确认→家长确认→闭环/复核/预锁/延后）
CREATE TABLE IF NOT EXISTS makeup_students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  makeup_session_id INT NULL,
  plan_id INT NOT NULL,
  student_id INT NOT NULL,
  class_id INT NOT NULL,
  order_id INT NULL,
  is_first_order TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否首次订购（竞争优先级因子）',
  -- 家长在补测前只能提交“参考尺码”，供应商不得计入正式数量
  ref_size_top VARCHAR(20) NULL,
  ref_size_pants VARCHAR(20) NULL,
  ref_size_skirt VARCHAR(20) NULL,
  ref_size_coat VARCHAR(20) NULL,
  ref_size_shoes VARCHAR(20) NULL,
  ref_submitted_at DATETIME NULL,
  -- 补测实测尺码
  meas_size_top VARCHAR(20) NULL,
  meas_size_pants VARCHAR(20) NULL,
  meas_size_skirt VARCHAR(20) NULL,
  meas_size_coat VARCHAR(20) NULL,
  meas_size_shoes VARCHAR(20) NULL,
  measured_by INT NULL,
  measured_at DATETIME NULL,
  teacher_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  teacher_confirmed_at DATETIME NULL,
  parent_confirmed TINYINT(1) NOT NULL DEFAULT 0,
  parent_confirmed_at DATETIME NULL,
  -- pending_ref 待提交参考尺码 / waiting 待测 / measured 已测待班主任确认 / teacher_done 待家长确认 /
  -- closed 两确认一致闭环 / review 两确认不一致待复核 / prelocked 总务批准按参考预锁 /
  -- postponed 总务批准延后 / overdue 补测逾期 / parent_timeout 家长超时未确认 / sample_shortage 样衣不足
  status ENUM('pending_ref','waiting','measured','teacher_done','closed','review','prelocked','postponed','overdue','parent_timeout','sample_shortage')
    NOT NULL DEFAULT 'pending_ref',
  deadline DATETIME NULL COMMENT '家长确认最终尺码的截止时间',
  ga_decision_by INT NULL,
  ga_decision_at DATETIME NULL,
  ga_decision_reason VARCHAR(300) COMMENT '总务预锁/延后原因（留入学生订单与班级进度）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mk_plan_student (plan_id, student_id),
  INDEX (makeup_session_id), INDEX (student_id), INDEX (status),
  CONSTRAINT fk_mkst_session FOREIGN KEY (makeup_session_id) REFERENCES makeup_sessions(id),
  CONSTRAINT fk_mkst_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_mkst_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_mkst_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_mkst_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_mkst_measurer FOREIGN KEY (measured_by) REFERENCES users(id),
  CONSTRAINT fk_mkst_ga FOREIGN KEY (ga_decision_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 补测样衣占用/归还（多个班级竞争同一批样衣的并发约束）
CREATE TABLE IF NOT EXISTS sample_reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  makeup_session_id INT NOT NULL,
  size VARCHAR(20) NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  status ENUM('reserved','returned','shortage') NOT NULL DEFAULT 'reserved',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (makeup_session_id),
  CONSTRAINT fk_sr_session FOREIGN KEY (makeup_session_id) REFERENCES makeup_sessions(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 补测异常台账：补测逾期 / 样衣不足 / 家长超时未确认 均可追溯
CREATE TABLE IF NOT EXISTS makeup_exceptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  class_id INT NULL,
  makeup_session_id INT NULL,
  makeup_student_id INT NULL,
  student_id INT NULL,
  type ENUM('makeup_overdue','sample_shortage','parent_timeout') NOT NULL,
  detail VARCHAR(500),
  status ENUM('open','resolved') NOT NULL DEFAULT 'open',
  resolved_by INT NULL,
  resolved_at DATETIME NULL,
  resolution VARCHAR(300),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (plan_id), INDEX (type), INDEX (status),
  CONSTRAINT fk_me_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_me_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_me_session FOREIGN KEY (makeup_session_id) REFERENCES makeup_sessions(id),
  CONSTRAINT fk_me_student_row FOREIGN KEY (makeup_student_id) REFERENCES makeup_students(id),
  CONSTRAINT fk_me_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_me_resolver FOREIGN KEY (resolved_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 围绕同一名学生/同一批校服的全过程留痕
CREATE TABLE IF NOT EXISTS activity_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  student_id INT NULL,
  order_id INT NULL,
  actor_role VARCHAR(30),
  actor_name VARCHAR(60),
  action VARCHAR(60),
  detail VARCHAR(500),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (student_id), INDEX (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
