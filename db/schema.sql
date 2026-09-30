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
  fitting_date DATE NULL,
  teacher_confirm_hours INT NOT NULL DEFAULT 24 COMMENT '补测后班主任确认测量记录的时限（小时）',
  parent_confirm_hours INT NOT NULL DEFAULT 48 COMMENT '班主任确认后家长确认最终尺码的时限（小时）',
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

-- 试穿时段（班主任按时段组织；kind=makeup 为集中试穿漏测后的补测场，关联 makeup_sessions）
CREATE TABLE IF NOT EXISTS fitting_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  class_id INT NOT NULL,
  kind ENUM('regular','makeup') NOT NULL DEFAULT 'regular',
  makeup_session_id INT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  location VARCHAR(100) NOT NULL,
  organizer_user_id INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (plan_id), INDEX (class_id), INDEX (makeup_session_id),
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

-- 订单（hold：迟缴费/转学等暂缓，供应商不可投产；review：班主任与家长两次确认不一致待复核）
CREATE TABLE IF NOT EXISTS orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_no VARCHAR(40) NOT NULL UNIQUE,
  plan_id INT NOT NULL,
  student_id INT NOT NULL,
  class_id INT NOT NULL,
  status ENUM('draft','confirmed','paid','hold','cancelled','review') NOT NULL DEFAULT 'draft',
  -- 生产锁定：none 正常；placeholder 补测前参考尺码风险占位（不计正式数量）；
  -- locked 双确认一致正式锁定；prelocked 总务批准按参考尺码预锁；deferred 总务批准延后
  production_lock ENUM('none','placeholder','locked','prelocked','deferred') NOT NULL DEFAULT 'none',
  hold_reason VARCHAR(200),
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

-- ============ 集中试穿漏测：补测与生产锁定 ============

-- 班主任空闲时间（生成补测候选时段的输入之一）
CREATE TABLE IF NOT EXISTS teacher_slots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_user_id INT NOT NULL,
  campus_id INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  note VARCHAR(200),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (teacher_user_id), INDEX (start_time),
  CONSTRAINT fk_ts_teacher FOREIGN KEY (teacher_user_id) REFERENCES users(id),
  CONSTRAINT fk_ts_campus FOREIGN KEY (campus_id) REFERENCES campuses(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 供应商样衣库存（按计划+校区+品类+尺码；多班竞争同一批样衣）
CREATE TABLE IF NOT EXISTS sample_stocks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  campus_id INT NOT NULL,
  supplier_id INT NOT NULL,
  plan_item_id INT NOT NULL,
  size VARCHAR(20) NOT NULL,
  total_qty INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sample (plan_id, campus_id, plan_item_id, size),
  INDEX (plan_id),
  CONSTRAINT fk_ss_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_ss_campus FOREIGN KEY (campus_id) REFERENCES campuses(id),
  CONSTRAINT fk_ss_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_ss_pi FOREIGN KEY (plan_item_id) REFERENCES plan_items(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 班级生产设置：班级生产截止日与到校承诺（计划×班级）
CREATE TABLE IF NOT EXISTS class_production_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  class_id INT NOT NULL,
  production_deadline DATETIME NOT NULL,
  promised_arrival DATE NULL,
  updated_by INT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cps (plan_id, class_id),
  CONSTRAINT fk_cps_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_cps_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_cps_user FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 补测场（候选 candidate → 已确认 confirmed → 人工调整 adjusted → 完成 completed / 取消 cancelled）
CREATE TABLE IF NOT EXISTS makeup_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  makeup_no VARCHAR(40) NOT NULL UNIQUE,
  plan_id INT NOT NULL,
  class_id INT NOT NULL,
  campus_id INT NOT NULL,
  supplier_id INT NOT NULL,
  start_time DATETIME NOT NULL,
  end_time DATETIME NOT NULL,
  location VARCHAR(100) NOT NULL,
  organizer_user_id INT NULL,
  status ENUM('candidate','confirmed','adjusted','completed','cancelled') NOT NULL DEFAULT 'candidate',
  priority_score INT NOT NULL DEFAULT 0,
  priority_detail VARCHAR(400),
  manual_adjust_reason VARCHAR(300),
  created_by INT NULL,
  confirmed_at DATETIME NULL,
  completed_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  cancel_reason VARCHAR(300),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (plan_id), INDEX (class_id), INDEX (status),
  CONSTRAINT fk_ms_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_ms_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_ms_campus FOREIGN KEY (campus_id) REFERENCES campuses(id),
  CONSTRAINT fk_ms_supplier FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  CONSTRAINT fk_ms_organizer FOREIGN KEY (organizer_user_id) REFERENCES users(id),
  CONSTRAINT fk_ms_creator FOREIGN KEY (created_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 补测学生（一个学生在一个计划下的补测/双确认/生产锁定链路）
CREATE TABLE IF NOT EXISTS makeup_students (
  id INT AUTO_INCREMENT PRIMARY KEY,
  plan_id INT NOT NULL,
  student_id INT NOT NULL,
  class_id INT NOT NULL,
  order_id INT NULL,
  makeup_session_id INT NULL,
  is_first_order TINYINT(1) NOT NULL DEFAULT 1,
  status ENUM('need_makeup','referenced','scheduled','measured','locked','review','prelocked','deferred') NOT NULL DEFAULT 'need_makeup',
  -- 家长补测前提交的参考尺码（仅风险占位，不计正式数量）
  ref_size_top VARCHAR(20) NULL,
  ref_size_pants VARCHAR(20) NULL,
  ref_size_skirt VARCHAR(20) NULL,
  ref_size_coat VARCHAR(20) NULL,
  ref_size_shoes VARCHAR(20) NULL,
  ref_submitted_at DATETIME NULL,
  -- 班主任补测测量并确认的记录
  m_size_top VARCHAR(20) NULL,
  m_size_pants VARCHAR(20) NULL,
  m_size_skirt VARCHAR(20) NULL,
  m_size_coat VARCHAR(20) NULL,
  m_size_shoes VARCHAR(20) NULL,
  m_staff_name VARCHAR(60),
  m_special_note VARCHAR(300),
  m_recorded_at DATETIME NULL,
  m_confirmed_at DATETIME NULL,
  m_confirmed_by INT NULL,
  -- 家长最终确认尺码
  f_size_top VARCHAR(20) NULL,
  f_size_pants VARCHAR(20) NULL,
  f_size_skirt VARCHAR(20) NULL,
  f_size_coat VARCHAR(20) NULL,
  f_size_shoes VARCHAR(20) NULL,
  f_confirmed_at DATETIME NULL,
  f_confirmed_by INT NULL,
  mismatch TINYINT(1) NOT NULL DEFAULT 0,
  -- 总务复核裁决 / 截止日处置
  review_resolution ENUM('use_teacher','use_parent','remeasure') NULL,
  decision_reason VARCHAR(300),
  decided_by INT NULL,
  decided_at DATETIME NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_mk_student (plan_id, student_id),
  INDEX (makeup_session_id), INDEX (status),
  CONSTRAINT fk_mk_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_mk_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_mk_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_mk_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_mk_session FOREIGN KEY (makeup_session_id) REFERENCES makeup_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 补测场对样衣的占用（同时段重叠的其他补测场不能重复占用）
CREATE TABLE IF NOT EXISTS sample_reservations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  makeup_session_id INT NOT NULL,
  sample_stock_id INT NOT NULL,
  qty INT NOT NULL DEFAULT 1,
  status ENUM('held','released') NOT NULL DEFAULT 'held',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_sr (makeup_session_id, sample_stock_id),
  INDEX (sample_stock_id),
  CONSTRAINT fk_sr_session FOREIGN KEY (makeup_session_id) REFERENCES makeup_sessions(id) ON DELETE CASCADE,
  CONSTRAINT fk_sr_stock FOREIGN KEY (sample_stock_id) REFERENCES sample_stocks(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 可追溯异常台账：补测逾期 / 样衣不足 / 班主任超时 / 家长超时 / 截止日未闭环 / 两次确认不一致
CREATE TABLE IF NOT EXISTS makeup_exceptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exc_no VARCHAR(40) NOT NULL UNIQUE,
  type ENUM('makeup_overdue','sample_shortage','teacher_timeout','parent_timeout','deadline_open','size_mismatch') NOT NULL,
  status ENUM('open','acknowledged','resolved') NOT NULL DEFAULT 'open',
  plan_id INT NOT NULL,
  class_id INT NULL,
  student_id INT NULL,
  makeup_session_id INT NULL,
  detail VARCHAR(500),
  raised_by VARCHAR(30) NOT NULL DEFAULT 'system',
  acknowledged_by INT NULL,
  resolved_by INT NULL,
  resolved_at DATETIME NULL,
  resolution VARCHAR(300),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX (plan_id), INDEX (type), INDEX (status),
  CONSTRAINT fk_ex_plan FOREIGN KEY (plan_id) REFERENCES plans(id),
  CONSTRAINT fk_ex_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_ex_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_ex_session FOREIGN KEY (makeup_session_id) REFERENCES makeup_sessions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 总务处置留痕（按参考尺码预锁 / 延后 / 复核裁决）及重算影响（班级数量、批次、到校承诺）
CREATE TABLE IF NOT EXISTS makeup_decisions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  makeup_student_id INT NOT NULL,
  order_id INT NULL,
  decision ENUM('prelock','defer','review_teacher','review_parent','review_remeasure') NOT NULL,
  reason VARCHAR(300) NOT NULL,
  impact VARCHAR(800),
  decided_by INT NOT NULL,
  decided_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX (makeup_student_id),
  CONSTRAINT fk_md_mk FOREIGN KEY (makeup_student_id) REFERENCES makeup_students(id),
  CONSTRAINT fk_md_order FOREIGN KEY (order_id) REFERENCES orders(id),
  CONSTRAINT fk_md_user FOREIGN KEY (decided_by) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

SET FOREIGN_KEY_CHECKS = 1;
