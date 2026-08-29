import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { vendorBrand } from "./brand.js";

const STORAGE_KEY = "dl-vendor-locale";
export const LOCALES = [
  { id: "zh", label: "中文", short: "中" },
  { id: "en", label: "English", short: "EN" },
  { id: "ko", label: "한국어", short: "한" },
];

const en = {
  "返回": "Back", "工作台": "Home", "订单": "Orders", "库存": "Inventory", "我的": "Profile", "主导航": "Main navigation",
  "供应商工作台": "Vendor workspace", "使用平台分配的账号登录。": "Sign in with the account assigned by the platform.", "邮箱": "Email", "密码": "Password", "登录": "Sign in",
  "设置密码并激活账号": "Set a password and activate", "此邀请链接将在使用后失效。": "This invitation link expires after use.", "设置密码": "Set password", "激活并登录": "Activate and sign in", "请稍候…": "Please wait…",
  "邮箱或密码不正确": "Incorrect email or password", "登录失败，请稍后重试": "Sign-in failed. Please try again.", "客户联系方式、零售价与付款信息不会显示在此端。": "Customer contacts, retail prices, and payment data are hidden here.",
  "忘记密码？": "Forgot password?", "重置密码": "Reset password", "输入登录邮箱，我们会发送一个一小时内有效的重置链接。": "Enter your sign-in email and we will send a reset link valid for one hour.", "发送重置链接": "Send reset link", "如果该邮箱对应有效账号，我们已经发送了密码重置链接。": "If an active account matches that email, we have sent a password reset link.", "返回登录": "Back to sign in",
  "设置新密码": "Set a new password", "请输入新的登录密码。": "Enter a new sign-in password.", "新密码": "New password", "确认新密码": "Confirm new password", "两次输入的密码不一致": "The passwords do not match", "重置并登录": "Reset and sign in", "重置链接无效或已过期": "This reset link is invalid or has expired",
  "暂时没有待处理订单": "No orders need attention", "匿名客户": "Anonymous customer", "不可用": "Unavailable", "正在保存…": "Saving…", "无法加载订单详情": "Could not load order details",
  "早上好": "Good morning",
  "早上好，华南工坊": "Good morning, South China Workshop", "通知": "Notifications", "今日优先": "TODAY'S PRIORITY", "7月14日 周二": "Tue, Jul 14",
  "有 3 项需要你处理": "3 items need your attention", "先确认新订单，避免影响承诺交期。": "Confirm new orders first to protect the promised lead time.",
  "订单概览": "Order overview", "待响应": "Awaiting response", "制作中": "In production", "待质检": "QC needed", "可用石": "Available stones",
  "进行中的订单": "Active orders", "全部": "All", "快捷操作": "Quick actions", "添加裸钻": "Add diamond", "录入证书和报价": "Enter certificate and quote",
  "上传进度": "Upload update", "照片或视频": "Photos or video", "待确认": "To confirm", "客户审核": "Client review", "终检": "Final QC", "已完成": "Completed",
  "搜索订单号或款式": "Search order or design", "按更新时间": "Last updated", "没有找到订单": "No orders found", "换个订单号或状态试试。": "Try another order number or status.",
  "订单工作区": "Order workspace", "整体进度": "Overall progress", "交期": "Due", "下一步": "Next step", "更新后订单团队会立即收到通知。": "The order team will be notified immediately.",
  "订单规格": "Order specifications", "客户要求": "Client request", "制作进度": "Production progress", "添加记录": "Add update", "例如：戒臂已抛光，明天完成镶石…": "Example: band polished; stone setting completes tomorrow…",
  "取消": "Cancel", "保存": "Save", "客户反馈": "Client feedback", "最新反馈": "Latest feedback", "由订单团队转达 · 客户联系方式已隐藏": "Relayed by the order team · client contact details hidden",
  "文件与影像": "Files & media", "上传": "Upload", "进度 07/13": "Update 07/13", "添加说明": "Add note", "进度说明已保存": "Progress note saved",
  "裸钻库存": "Diamond inventory", "可用库存": "Available inventory", "颗裸钻": "diamonds", "库存成本": "Inventory cost", "当前可用": "currently available", "可用": "Available", "已预留": "Reserved", "已售": "Sold", "添加一颗裸钻": "Add a diamond",
  "华南工坊": "South China Workshop", "供应商 ID · CN-01": "Vendor ID · CN-01", "合作中": "Active partner", "本月已完成": "Completed this month", "个订单": "orders", "准时交付率": "On-time delivery", "近 90 天": "Last 90 days",
  "通知设置": "Notification settings", "账号与工坊资料": "Account & workshop", "语言与显示": "Language & display", "简体中文": "Simplified Chinese", "数据与隐私": "Data & privacy", "退出登录": "Sign out",
  "通知设置已打开": "Notification settings opened", "账号由平台管理": "Account managed by the platform", "数据通过加密连接同步": "Data syncs over an encrypted connection", "选择语言": "Choose language", "界面语言会保存在此设备上。": "Your interface language is saved on this device.",
  "关闭": "Close", "内容类型": "Content type", "CAD / 方案": "CAD / Proposal", "成品质检": "Finished-piece QC", "从手机选择照片或视频": "Choose photos or videos from your phone", "选择多张照片或视频": "Choose multiple photos or videos", "继续添加照片或视频": "Add more photos or videos", "可一次选择或分次添加多张 · 视频单个最大 200MB": "Choose several at once or add more later · each video up to 200MB", "支持 JPG、PNG、WebP、MP4 · 视频最大 200MB": "JPG, PNG, WebP, MP4 · videos up to 200MB",
  "进度说明（选填）": "Update note (optional)", "说明这次更新完成了什么、下一步是什么…": "Describe what was completed and what comes next…", "安全直传": "Secure direct upload", "文件从手机直接上传到腾讯云 COS，API 只保存对象标识。": "Files upload directly from the phone to Tencent Cloud COS; the API stores only the object key.", "正在上传…": "Uploading…", "确认上传": "Confirm upload", "上传到": "Upload to",
  "寄件与物流凭证": "Shipment and carrier receipt", "填写物流并确认寄出": "Enter shipping and confirm dispatch", "填写寄往 BeloveD 的物流单号": "Enter the tracking number to BeloveD", "上传至少一张寄件面单或收据照片": "Upload at least one label or receipt photo", "确认包装完成后再提交": "Submit after packaging is complete", "物流单号": "Tracking number", "请输入快递或物流单号": "Enter carrier tracking number", "寄件说明（选填）": "Shipping note (optional)", "例如：已使用顺丰寄出，包装完好…": "Example: handed to the carrier with packaging intact…", "确认包裹已寄出": "Confirm package shipped", "寄件信息已记录": "Shipment recorded", "供应商已寄出": "Supplier package shipped", "包裹已寄出，等待 Operations 确认收货": "Package shipped; waiting for Operations to confirm receipt", "待寄出": "Ready to ship", "请填写物流单号并上传寄件凭证": "Enter tracking and upload the shipping receipt",
  "形状": "Shape", "克拉": "Carat", "颜色": "Color", "净度": "Clarity", "IGI 证书号": "IGI certificate no.", "例如 655482310": "e.g. 655482310", "供应价（USD）": "Vendor price (USD)", "例如 510": "e.g. 510", "添加实拍与证书照片": "Add stone and certificate media", "至少 1 张，建议包含 360° 视频": "At least 1 image; 360° video recommended", "保存裸钻": "Save diamond", "裸钻已添加到库存池": "Diamond added to inventory pool",
  "圆形": "Round", "椭圆": "Oval", "祖母绿形": "Emerald", "公主方": "Princess", "梨形": "Pear", "戒指": "Ring", "吊坠": "Pendant",
  "六爪经典订婚戒": "Classic six-prong engagement ring", "椭圆主石隐形光环": "Oval hidden-halo ring", "祖母绿切割吊坠": "Emerald-cut pendant", "半圈排钻婚戒": "Half-eternity wedding band",
  "请上传今日制作进度": "Upload today's production update", "需要确认报价与交期": "Confirm quote and lead time", "客户正在审核 CAD v1": "Client is reviewing CAD v1", "请上传成品照片与质检结果": "Upload finished-piece photos and QC results",
  "主石": "Center stone", "戒托": "Setting", "尺寸": "Size", "刻字": "Engraving", "金属": "Metal", "链长": "Chain length", "钻石": "Diamonds", "无": "None",
  "圆形 · 1.52ct · E / VS1 · CVD": "Round · 1.52ct · E / VS1 · CVD", "PT950 铂金": "PT950 platinum", "椭圆 · 1.80–2.00ct · F+ / VS1+": "Oval · 1.80–2.00ct · F+ / VS1+", "18K 玫瑰金": "18K rose gold", "祖母绿形 · 1.20ct · F / VVS2": "Emerald · 1.20ct · F / VVS2", "18K 白金": "18K white gold", "圆钻 · 0.35ct 总重": "Round diamonds · 0.35ct total", "18K 黄金": "18K yellow gold",
  "戒臂要细，六爪对称。客户希望主石尽量显大，但不要高托。": "Keep the band slim and the six prongs symmetrical. The client wants a larger face-up look without a high setting.",
  "戒臂可以再细一点吗？目标 1.7mm，其余都确认。": "Could the band be slimmer? Target 1.7mm; everything else is approved.",
  "需要根据参考图给出 CAD 与工期，副石不要太抢主石。": "Provide CAD and lead time from the reference; accent stones should not overpower the center.", "尚无客户反馈": "No client feedback yet",
  "极简四爪，吊坠背面需要留出清洁开口。": "Minimal four-prong setting with a cleaning opening on the back.", "正在等待客户回复": "Waiting for client response",
  "成品图需要包含正面、侧面、刻字和上手比例。": "Finished photos must show front, side, engraving, and on-hand scale.", "CAD 已确认，无修改。": "CAD approved with no changes.",
  "订单已确认": "Order confirmed", "CAD v2 已通过": "CAD v2 approved", "进入制作": "Production started", "等待今日更新": "Today's update pending", "终检 QC": "Final QC", "待开始": "Not started",
  "新订单分配": "New order assigned", "确认报价与交期": "Confirm quote and lead time", "上传 CAD": "Upload CAD", "客户确认": "Client confirmation", "CAD v1 已上传": "CAD v1 uploaded", "已等待 2 小时": "Waiting 2 hours", "CAD 已通过": "CAD approved", "制作完成": "Production completed", "等待上传": "Upload pending", "交付平台": "Handoff ready",
};

const ko = {
  "返回": "뒤로", "工作台": "홈", "订单": "주문", "库存": "재고", "我的": "내 정보", "主导航": "메인 내비게이션",
  "供应商工作台": "벤더 작업공간", "使用平台分配的账号登录。": "플랫폼에서 발급한 계정으로 로그인하세요.", "邮箱": "이메일", "密码": "비밀번호", "登录": "로그인",
  "设置密码并激活账号": "비밀번호 설정 및 계정 활성화", "此邀请链接将在使用后失效。": "초대 링크는 사용 후 만료됩니다.", "设置密码": "비밀번호 설정", "激活并登录": "활성화 후 로그인", "请稍候…": "잠시만 기다려 주세요…",
  "邮箱或密码不正确": "이메일 또는 비밀번호가 올바르지 않습니다", "登录失败，请稍后重试": "로그인에 실패했습니다. 다시 시도해 주세요.", "客户联系方式、零售价与付款信息不会显示在此端。": "고객 연락처, 소매가, 결제 정보는 표시되지 않습니다.",
  "忘记密码？": "비밀번호를 잊으셨나요?", "重置密码": "비밀번호 재설정", "输入登录邮箱，我们会发送一个一小时内有效的重置链接。": "로그인 이메일을 입력하면 1시간 동안 유효한 재설정 링크를 보내드립니다.", "发送重置链接": "재설정 링크 보내기", "如果该邮箱对应有效账号，我们已经发送了密码重置链接。": "해당 이메일의 활성 계정이 있다면 비밀번호 재설정 링크를 보냈습니다.", "返回登录": "로그인으로 돌아가기",
  "设置新密码": "새 비밀번호 설정", "请输入新的登录密码。": "새 로그인 비밀번호를 입력하세요.", "新密码": "새 비밀번호", "确认新密码": "새 비밀번호 확인", "两次输入的密码不一致": "비밀번호가 일치하지 않습니다", "重置并登录": "재설정 후 로그인", "重置链接无效或已过期": "재설정 링크가 잘못되었거나 만료되었습니다",
  "暂时没有待处理订单": "처리할 주문이 없습니다", "匿名客户": "익명 고객", "不可用": "사용 불가", "正在保存…": "저장 중…", "无法加载订单详情": "주문 상세를 불러오지 못했습니다",
  "早上好": "좋은 아침이에요",
  "早上好，华南工坊": "좋은 아침이에요, 화남 공방", "通知": "알림", "今日优先": "오늘의 우선 작업", "7月14日 周二": "7월 14일 화요일",
  "有 3 项需要你处理": "처리할 항목이 3개 있어요", "先确认新订单，避免影响承诺交期。": "약속한 납기를 지키려면 새 주문부터 확인해 주세요.",
  "订单概览": "주문 요약", "待响应": "응답 대기", "制作中": "제작 중", "待质检": "검수 대기", "可用石": "사용 가능 스톤",
  "进行中的订单": "진행 중 주문", "全部": "전체", "快捷操作": "빠른 작업", "添加裸钻": "나석 추가", "录入证书和报价": "감정서와 견적 입력",
  "上传进度": "진행 상황 업로드", "照片或视频": "사진 또는 영상", "待确认": "확인 대기", "客户审核": "고객 검토", "终检": "최종 검수", "已完成": "완료",
  "搜索订单号或款式": "주문번호 또는 디자인 검색", "按更新时间": "업데이트순", "没有找到订单": "주문을 찾지 못했어요", "换个订单号或状态试试。": "다른 주문번호나 상태로 검색해 보세요.",
  "订单工作区": "주문 작업공간", "整体进度": "전체 진행률", "交期": "납기", "下一步": "다음 단계", "更新后订单团队会立即收到通知。": "업데이트하면 주문팀에 즉시 알려드려요.",
  "订单规格": "주문 사양", "客户要求": "고객 요청", "制作进度": "제작 진행", "添加记录": "기록 추가", "例如：戒臂已抛光，明天完成镶石…": "예: 밴드 연마 완료, 내일 세팅 완료 예정…", "取消": "취소", "保存": "저장",
  "客户反馈": "고객 피드백", "最新反馈": "최신 피드백", "由订单团队转达 · 客户联系方式已隐藏": "주문팀 전달 · 고객 연락처 비공개", "文件与影像": "파일 및 미디어", "上传": "업로드", "进度 07/13": "진행 07/13", "添加说明": "설명 추가", "进度说明已保存": "진행 설명을 저장했어요",
  "裸钻库存": "나석 재고", "可用库存": "사용 가능 재고", "颗裸钻": "개 나석", "库存成本": "재고 원가", "当前可用": "현재 사용 가능", "可用": "사용 가능", "已预留": "예약됨", "已售": "판매됨", "添加一颗裸钻": "나석 추가",
  "华南工坊": "화남 공방", "供应商 ID · CN-01": "벤더 ID · CN-01", "合作中": "협업 중", "本月已完成": "이번 달 완료", "个订单": "개 주문", "准时交付率": "정시 납품률", "近 90 天": "최근 90일",
  "通知设置": "알림 설정", "账号与工坊资料": "계정 및 공방 정보", "语言与显示": "언어 및 화면", "简体中文": "중국어 간체", "数据与隐私": "데이터 및 개인정보", "退出登录": "로그아웃",
  "通知设置已打开": "알림 설정을 열었어요", "账号由平台管理": "계정은 플랫폼에서 관리해요", "数据通过加密连接同步": "데이터는 암호화 연결로 동기화돼요", "选择语言": "언어 선택", "界面语言会保存在此设备上。": "선택한 언어는 이 기기에 저장됩니다.", "关闭": "닫기",
  "内容类型": "콘텐츠 유형", "CAD / 方案": "CAD / 제안", "成品质检": "완성품 검수", "从手机选择照片或视频": "휴대폰에서 사진 또는 영상 선택", "选择多张照片或视频": "사진 또는 영상 여러 개 선택", "继续添加照片或视频": "사진 또는 영상 더 추가", "可一次选择或分次添加多张 · 视频单个最大 200MB": "한 번에 여러 개를 선택하거나 나중에 추가할 수 있어요 · 영상당 최대 200MB", "支持 JPG、PNG、WebP、MP4 · 视频最大 200MB": "JPG, PNG, WebP, MP4 · 영상 최대 200MB",
  "进度说明（选填）": "진행 설명(선택)", "说明这次更新完成了什么、下一步是什么…": "완료한 작업과 다음 단계를 적어주세요…", "安全直传": "안전한 직접 업로드", "文件从手机直接上传到腾讯云 COS，API 只保存对象标识。": "파일은 휴대폰에서 Tencent COS로 바로 업로드되고 API에는 객체 키만 저장됩니다.", "正在上传…": "업로드 중…", "确认上传": "업로드 확인", "上传到": "업로드 대상",
  "寄件与物流凭证": "발송 및 물류 증빙", "填写物流并确认寄出": "운송장 입력 후 발송 확인", "填写寄往 BeloveD 的物流单号": "BeloveD로 보내는 운송장 번호 입력", "上传至少一张寄件面单或收据照片": "운송장 또는 영수증 사진을 한 장 이상 업로드", "确认包装完成后再提交": "포장 완료 후 제출", "物流单号": "운송장 번호", "请输入快递或物流单号": "택배 운송장 번호 입력", "寄件说明（选填）": "발송 설명(선택)", "例如：已使用顺丰寄出，包装完好…": "예: 포장 완료 후 택배사에 인계…", "确认包裹已寄出": "패키지 발송 확인", "寄件信息已记录": "발송 정보 기록 완료", "供应商已寄出": "공급업체 발송 완료", "包裹已寄出，等待 Operations 确认收货": "발송 완료, Operations 수령 확인 대기", "待寄出": "발송 대기", "请填写物流单号并上传寄件凭证": "운송장 번호와 발송 증빙을 올려주세요",
  "形状": "형태", "克拉": "캐럿", "颜色": "컬러", "净度": "클래리티", "IGI 证书号": "IGI 감정서 번호", "例如 655482310": "예: 655482310", "供应价（USD）": "공급가(USD)", "例如 510": "예: 510", "添加实拍与证书照片": "실물 및 감정서 사진 추가", "至少 1 张，建议包含 360° 视频": "최소 1장, 360° 영상 권장", "保存裸钻": "나석 저장", "裸钻已添加到库存池": "나석을 재고 풀에 추가했어요",
  "圆形": "라운드", "椭圆": "오벌", "祖母绿形": "에메랄드", "公主方": "프린세스", "梨形": "페어", "戒指": "반지", "吊坠": "펜던트",
  "六爪经典订婚戒": "클래식 6프롱 약혼반지", "椭圆主石隐形光环": "오벌 히든 헤일로 반지", "祖母绿切割吊坠": "에메랄드 컷 펜던트", "半圈排钻婚戒": "하프 이터니티 웨딩밴드",
  "请上传今日制作进度": "오늘의 제작 진행 상황을 올려주세요", "需要确认报价与交期": "견적과 납기를 확인해 주세요", "客户正在审核 CAD v1": "고객이 CAD v1을 검토 중이에요", "请上传成品照片与质检结果": "완성품 사진과 검수 결과를 올려주세요",
  "主石": "센터 스톤", "戒托": "세팅", "尺寸": "사이즈", "刻字": "각인", "金属": "메탈", "链长": "체인 길이", "钻石": "다이아몬드", "无": "없음",
  "圆形 · 1.52ct · E / VS1 · CVD": "라운드 · 1.52ct · E / VS1 · CVD", "PT950 铂金": "PT950 플래티넘", "椭圆 · 1.80–2.00ct · F+ / VS1+": "오벌 · 1.80–2.00ct · F+ / VS1+", "18K 玫瑰金": "18K 로즈 골드", "祖母绿形 · 1.20ct · F / VVS2": "에메랄드 · 1.20ct · F / VVS2", "18K 白金": "18K 화이트 골드", "圆钻 · 0.35ct 总重": "라운드 다이아 · 총 0.35ct", "18K 黄金": "18K 옐로 골드",
  "戒臂要细，六爪对称。客户希望主石尽量显大，但不要高托。": "밴드는 얇고 6개 프롱은 대칭이어야 합니다. 고객은 높은 세팅 없이 센터가 커 보이길 원해요.", "戒臂可以再细一点吗？目标 1.7mm，其余都确认。": "밴드를 조금 더 얇게 할 수 있나요? 목표는 1.7mm이며 나머지는 모두 확인했습니다.",
  "需要根据参考图给出 CAD 与工期，副石不要太抢主石。": "참고 이미지 기준 CAD와 납기를 제시하고, 사이드 스톤은 센터보다 튀지 않게 해주세요.", "尚无客户反馈": "아직 고객 피드백이 없어요", "极简四爪，吊坠背面需要留出清洁开口。": "미니멀 4프롱이며 펜던트 뒷면에 세척용 오프닝이 필요합니다.", "正在等待客户回复": "고객 응답을 기다리는 중이에요", "成品图需要包含正面、侧面、刻字和上手比例。": "완성품 사진에 정면, 측면, 각인, 착용 비율을 포함해 주세요.", "CAD 已确认，无修改。": "CAD 확인 완료, 수정 없음.",
  "订单已确认": "주문 확인 완료", "CAD v2 已通过": "CAD v2 승인", "进入制作": "제작 시작", "等待今日更新": "오늘 업데이트 대기", "终检 QC": "최종 QC", "待开始": "시작 전", "新订单分配": "새 주문 배정", "确认报价与交期": "견적 및 납기 확인", "上传 CAD": "CAD 업로드", "客户确认": "고객 확인", "CAD v1 已上传": "CAD v1 업로드 완료", "已等待 2 小时": "2시간째 대기", "CAD 已通过": "CAD 승인", "制作完成": "제작 완료", "等待上传": "업로드 대기", "交付平台": "플랫폼 인계",
};

function formatDynamic(value, locale) {
  if (typeof value !== "string" || locale === "zh") return value;
  let match = value.match(/^(\d+) 个订单$/);
  if (match) return locale === "en" ? `${match[1]} orders` : `주문 ${match[1]}개`;
  match = value.match(/^(\d+) 条新消息$/);
  if (match) return locale === "en" ? `${match[1]} new messages` : `새 메시지 ${match[1]}개`;
  match = value.match(/^(\d+) 个影像$/);
  if (match) return locale === "en" ? `${match[1]} media` : `미디어 ${match[1]}개`;
  match = value.match(/^(\d+) 个文件已上传$/);
  if (match) return locale === "en" ? `${match[1]} files uploaded` : `파일 ${match[1]}개를 업로드했어요`;
  match = value.match(/^客户 (A-\d+)$/);
  if (match) return locale === "en" ? `Client ${match[1]}` : `고객 ${match[1]}`;
  match = value.match(/^(\d+)分钟前$/);
  if (match) return locale === "en" ? `${match[1]}m ago` : `${match[1]}분 전`;
  match = value.match(/^(\d+)小时前$/);
  if (match) return locale === "en" ? `${match[1]}h ago` : `${match[1]}시간 전`;
  match = value.match(/^(\d+)月(\d+)日(.*)$/);
  if (match) return locale === "en" ? `${match[1]}/${match[2]}${match[3]}` : `${match[1]}월 ${match[2]}일${match[3]}`;
  return value;
}

const I18nContext = createContext(null);

export function LocaleProvider({ children }) {
  const [locale, setLocaleState] = useState(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return LOCALES.some(x => x.id === saved) ? saved : "zh";
  });
  const setLocale = (next) => {
    if (!LOCALES.some(x => x.id === next)) return;
    localStorage.setItem(STORAGE_KEY, next);
    document.documentElement.lang = next === "zh" ? "zh-CN" : next;
    setLocaleState(next);
  };
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : locale;
    document.title = `${vendorBrand(locale).name} Workshop`;
  }, [locale]);
  const value = useMemo(() => ({
    locale,
    setLocale,
    t: (text) => formatDynamic((locale === "en" ? en : locale === "ko" ? ko : {})[text] || text, locale),
  }), [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
