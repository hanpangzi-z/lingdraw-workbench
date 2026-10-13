from __future__ import annotations

import json
from typing import Any, Dict, List, Literal, Optional, Type, TypeVar

from pydantic import BaseModel, Field

from .domain import parse_json_object


class WorkbenchReference(BaseModel):
    url: str = Field(min_length=1, max_length=8000)
    name: str = Field(default="参考素材", max_length=240)


class WorkbenchClarificationAnswer(BaseModel):
    question_id: str = Field(min_length=1, max_length=80)
    question: str = Field(min_length=1, max_length=300)
    option_ids: List[str] = Field(default_factory=list, max_length=6)
    values: List[str] = Field(min_length=1, max_length=6)


class WorkbenchPlanRequest(BaseModel):
    request_id: str = Field(min_length=8, max_length=160)
    message: str = Field(min_length=1, max_length=12000)
    canvas_id: str = Field(default="", max_length=160)
    session_id: str = Field(default="", max_length=160)
    turn_id: str = Field(default="", max_length=160)
    parent_turn_id: str = Field(default="", max_length=160)
    mode_hint: str = Field(default="", max_length=80)
    skill: str = Field(default="Design Agent", max_length=160)
    provider: str = Field(default="comfly", max_length=160)
    model: str = Field(default="", max_length=240)
    allow_model_fallback: bool = True
    brand_kit: Dict[str, Any] = Field(default_factory=dict)
    reference_images: List[WorkbenchReference] = Field(default_factory=list, max_length=8)
    selected_assets: List[Dict[str, Any]] = Field(default_factory=list, max_length=8)
    prior_turns: List[Dict[str, Any]] = Field(default_factory=list, max_length=6)
    previous_plan: Dict[str, Any] = Field(default_factory=dict)
    previous_review: Dict[str, Any] = Field(default_factory=dict)
    clarification_id: str = Field(default="", max_length=120)
    clarification_answers: List[WorkbenchClarificationAnswer] = Field(default_factory=list, max_length=3)
    skip_clarification: bool = False


class WorkbenchColor(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    value: str = Field(min_length=1, max_length=40)


class WorkbenchPlanSection(BaseModel):
    kind: Literal["positioning", "audience", "layout", "color", "typography", "lighting", "fidelity", "other"]
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=1200)
    details: List[str] = Field(default_factory=list, max_length=8)
    colors: List[WorkbenchColor] = Field(default_factory=list, max_length=8)


class WorkbenchDesignPlan(BaseModel):
    acknowledgement: str = Field(min_length=1, max_length=500)
    title: str = Field(min_length=1, max_length=120)
    sections: List[WorkbenchPlanSection] = Field(min_length=3, max_length=8)
    generation_prompt: str = Field(min_length=20, max_length=8000)


class WorkbenchWorkflowModule(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    purpose: str = Field(min_length=1, max_length=500)
    content: str = Field(min_length=1, max_length=1200)
    generation_prompt: str = Field(min_length=20, max_length=8000)
    estimated_generation_count: int = Field(default=1, ge=1, le=4)
    estimated_points: int = Field(default=1, ge=0, le=1000)


class WorkbenchWorkflowPlan(BaseModel):
    skill_slug: str = Field(default="product-detail-page", min_length=1, max_length=120)
    workflow_version: int = Field(default=1, ge=1, le=100)
    title: str = Field(min_length=1, max_length=160)
    summary: str = Field(min_length=1, max_length=1200)
    modules: List[WorkbenchWorkflowModule] = Field(min_length=4, max_length=12)
    estimated_generation_count: int = Field(ge=4, le=48)
    estimated_points: int = Field(ge=0, le=12000)


class WorkbenchWorkflowModuleRevisionRequest(BaseModel):
    request_id: str = Field(min_length=8, max_length=160)
    message: str = Field(min_length=1, max_length=12000)
    skill: str = Field(default="Design Agent", max_length=160)
    provider: str = Field(default="comfly", max_length=160)
    model: str = Field(default="", max_length=240)
    allow_model_fallback: bool = True
    workflow_plan: Dict[str, Any] = Field(default_factory=dict)
    original_module: WorkbenchWorkflowModule
    edited_module: WorkbenchWorkflowModule


class WorkbenchWorkflowModuleRevision(BaseModel):
    module: WorkbenchWorkflowModule
    summary: str = Field(min_length=1, max_length=800)
    cautions: List[str] = Field(default_factory=list, max_length=5)


class WorkbenchReferenceAnalysis(BaseModel):
    reference_index: int = Field(ge=1, le=8)
    subject_name: str = Field(min_length=1, max_length=160)
    relationship: Literal["independent_subject", "same_subject_view", "style_reference", "layout_reference"]
    grouped_with_reference_index: Optional[int] = Field(default=None, ge=1, le=8)
    must_appear: bool
    evidence: str = Field(min_length=1, max_length=500)


class WorkbenchClarificationOption(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    label: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=300)


class WorkbenchClarificationQuestion(BaseModel):
    id: str = Field(min_length=1, max_length=80)
    question: str = Field(min_length=1, max_length=300)
    description: str = Field(default="", max_length=500)
    selection: Literal["single", "multiple"] = "single"
    required: bool = True
    options: List[WorkbenchClarificationOption] = Field(min_length=2, max_length=6)
    recommended_option_id: str = Field(default="", max_length=80)


class WorkbenchClarification(BaseModel):
    id: str = Field(min_length=1, max_length=120)
    introduction: str = Field(min_length=1, max_length=800)
    questions: List[WorkbenchClarificationQuestion] = Field(min_length=1, max_length=3)


class WorkbenchRoutingDecision(BaseModel):
    status: Literal["needs_clarification", "ready"]
    route: Literal["clarify", "plan_and_generate", "direct_generate", "edit_image", "specialist_workflow"]
    reason: str = Field(min_length=1, max_length=800)
    acknowledgement: str = Field(min_length=1, max_length=500)
    clarification: Optional[WorkbenchClarification] = None
    plan: Optional[WorkbenchDesignPlan] = None
    generation_prompt: str = Field(default="", max_length=8000)
    reference_analysis: List[WorkbenchReferenceAnalysis] = Field(default_factory=list, max_length=8)
    workflow_plan: Optional[WorkbenchWorkflowPlan] = None


class WorkbenchReviewRequest(BaseModel):
    request_id: str = Field(min_length=8, max_length=160)
    message: str = Field(min_length=1, max_length=12000)
    skill: str = Field(default="Design Agent", max_length=160)
    provider: str = Field(default="comfly", max_length=160)
    model: str = Field(default="", max_length=240)
    allow_model_fallback: bool = True
    image_url: str = Field(min_length=1, max_length=8000)
    image_name: str = Field(default="生成结果", max_length=240)
    reference_images: List[WorkbenchReference] = Field(default_factory=list, max_length=8)
    workflow_reference_images: List[WorkbenchReference] = Field(default_factory=list, max_length=12)
    # The routing response can intentionally omit parts of a formal design plan
    # for direct_generate / edit_image turns.  Review only uses this value as
    # model context, so rejecting a successful generated image because its plan
    # is partial would make the review stage less reliable than generation.
    plan: Dict[str, Any] = Field(default_factory=dict)


class WorkbenchMarkerRecognitionRequest(BaseModel):
    request_id: str = Field(min_length=8, max_length=160)
    image_url: str = Field(min_length=1, max_length=8000)
    target_name: str = Field(default="画布图片", max_length=240)
    marker_number: int = Field(ge=1, le=999)
    x_percent: int = Field(ge=0, le=100)
    y_percent: int = Field(ge=0, le=100)
    provider: str = Field(default="comfly", max_length=160)
    model: str = Field(default="", max_length=240)
    allow_model_fallback: bool = True


class WorkbenchMarkerRecognition(BaseModel):
    label: str = Field(min_length=1, max_length=40)
    description: str = Field(min_length=1, max_length=400)


class WorkbenchReviewHighlight(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    detail: str = Field(min_length=1, max_length=800)


class WorkbenchReviewCheck(BaseModel):
    label: str = Field(min_length=1, max_length=120)
    passed: bool
    score: int = Field(ge=0, le=100)
    detail: str = Field(min_length=1, max_length=800)


class WorkbenchReferenceReview(BaseModel):
    reference_index: int = Field(ge=1, le=8)
    verdict: Literal["present", "same_subject_view_covered", "missing", "unclear", "not_required"]
    evidence: str = Field(min_length=1, max_length=500)


class WorkbenchFollowUp(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    instruction: str = Field(min_length=1, max_length=1200)


class WorkbenchResultReview(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(min_length=1, max_length=1200)
    overall_score: int = Field(ge=0, le=100)
    passed: bool
    highlights: List[WorkbenchReviewHighlight] = Field(min_length=2, max_length=6)
    checks: List[WorkbenchReviewCheck] = Field(min_length=4, max_length=9)
    reference_checks: List[WorkbenchReferenceReview] = Field(default_factory=list, max_length=8)
    conclusion: str = Field(min_length=1, max_length=1200)
    suggestions: List[WorkbenchFollowUp] = Field(min_length=2, max_length=5)


PLAN_SYSTEM_PROMPT = """你是设计智能体的需求分析与执行路由器。每次都必须综合真实 Brief、Skill、品牌资料、参考图、选中成果、最近轮次、上一方案、上一质量报告和用户已有澄清答案，先判断信息是否足以执行，再决定正确路径。禁止按字符长度、固定关键词或固定问题模板判断。

多图参考规则：reference_materials 按实际传入图片的顺序以“参考图1、参考图2……”编号。必须逐张查看并建立 reference_analysis：每张输入图恰好一项，不能漏项、重复或用笼统的“全部参考图”替代。先根据可见外形、包装结构、颜色和标识判断它是独立商品、同商品另一视角、风格参考还是构图参考；只有能给出明确视觉证据时才能判为同商品另一视角。不同商品、不同包装或不同规格必须分别保留。用户选择“全部、全家福、组合展示”等方向时，独立商品 must_appear 必须为 true，方案和 generation_prompt 必须逐一写出参考图编号、具体物品与数量，不得只概括前几张，也不得把多个独立商品合并成一个虚构商品。无论用途如何，可执行 generation_prompt 都必须出现每一个“参考图N”编号并说明其用法。

只返回一个 JSON 对象，不要 Markdown、解释或代码围栏。status 与 route 的规则：
- needs_clarification + clarify：仍缺少会显著改变视觉结果的关键决策，而且至少存在两个合理但结果明显不同的方向。只问 1-3 个最高影响问题，每题动态生成 2-6 个与本次任务直接相关的选项；上下文已回答的内容不得重复询问。
- ready + plan_and_generate：复杂品牌、营销、Skill、多约束或需要设计推导的任务，先形成完整方案再生成。
- ready + direct_generate：目标、主体、风格与用途已经明确，可直接生成新图，无需展示完整方案。
- ready + edit_image：已有参考图或选中对象，且用户明确要求修改、延展或创建子版本。
- ready + specialist_workflow：商品详情页、系列页面或其它需要多张成果共同组成的视觉交付。依据产品、平台、受众和叙事动态拆分为 4-12 个模块，不得固定成 8 个；只规划，不得在用户确认模块前开始生图。手动选择“商品详情页” Skill 时必须优先使用此路径，且适用于任意商品品类。多模块必须共用同一个已确认的产品身份基准；没有产品参考图时，模块规划必须允许先生成并确认产品母图。只能使用用户明确提供的事实；未提供的型号、单元、尺寸、重量、蓝牙版本、续航拆分、认证等参数不得虚构，规格模块资料不足时必须明确标为待补充。

多模块文案规则：默认同时为后续“有文案”版本准备可直接排版的文案。除非用户明确要求无字图，否则 content 和 generation_prompt 必须写出确切的主标题「……」、副标题「……」及需要展示的卖点短句，不能只写“预留标题区”“保留文案安全区”或“后期加字”。可以依据已确认的商品名称、品类、用途和真实卖点组织简短非量化表达，但不得编造参数、认证、销量、优惠、功效、品牌口号或绝对化承诺；事实不足时用中性品类文案，并在模块说明中标为“待补充”，不得要求把占位符画进成图。用户在生成前可以另选“无文案”版本，执行器会明确忽略新增营销文案并保留包装原有标识。

多轮规则：
- 有 parent_turn_id、选中成果或上一轮成果时，把当前输入视为对既有工作的延续，不得重置成一个孤立的新 Brief。
- 父成果明确且修改内容可执行（例如把文字向内收以满足印刷安全区）时，直接返回 ready + edit_image。
- “更高级一点”等主观且存在多种明显不同设计方向的请求，需要返回 needs_clarification + clarify，由当前上下文动态生成问题。
- prior_turns 已经确认的约束不得重复询问；上一质量报告指出的问题应成为修改或方案依据。

如果请求中已有 clarification_answers 或 skip_clarification=true，禁止再次追问；剩余小歧义由 Agent 做专业判断并返回 ready。

JSON 结构：
{
  "status": "needs_clarification|ready",
  "route": "clarify|plan_and_generate|direct_generate|edit_image|specialist_workflow",
  "reason": "为什么分配到这条路径的具体判断",
  "acknowledgement": "一句具体复述本次任务与已知约束的话",
  "reference_analysis": [{"reference_index":1,"subject_name":"该图中的具体商品或视觉用途","relationship":"independent_subject|same_subject_view|style_reference|layout_reference","grouped_with_reference_index":null,"must_appear":true,"evidence":"据以判断关系的可见外形、包装或标识证据"}],
  "clarification": {
    "id": "本轮稳定 ID",
    "introduction": "说明还需要用户决定什么以及为什么",
    "questions": [{
      "id": "问题稳定 ID",
      "question": "针对本任务的问题",
      "description": "可选的简短解释",
      "selection": "single|multiple",
      "required": true,
      "recommended_option_id": "推荐选项 ID 或空字符串",
      "options": [{"id":"选项 ID","label":"选项名称","description":"这个方向对成图的具体影响"}]
    }]
  },
  "plan": {
    "acknowledgement": "一句具体复述任务与关键约束的话",
    "title": "方案标题",
    "sections": [{"kind":"positioning|audience|layout|color|typography|lighting|fidelity|other","title":"维度标题","summary":"针对本任务的分析","details":["可执行细节"],"colors":[{"name":"颜色用途","value":"#RRGGBB"}]}],
    "generation_prompt": "融合全部分析、交付规格、必须保留内容与禁用项的完整中文生图提示词"
  },
  "generation_prompt": "direct_generate 或 edit_image 路径使用的完整中文执行提示词；其他路径可为空",
  "workflow_plan": {
    "skill_slug": "product-detail-page",
    "workflow_version": 1,
    "title": "本次多模块视觉交付名称",
    "summary": "统一视觉体系、卖点顺序和叙事说明",
    "modules": [{"id":"稳定模块ID","name":"模块名称","purpose":"模块目的","content":"主要内容","generation_prompt":"该模块可独立执行且包含交付规格的完整提示词","estimated_generation_count":1,"estimated_points":1}],
    "estimated_generation_count": 4,
    "estimated_points": 4
  }
}
needs_clarification 时 clarification 必填、plan 和 workflow_plan 为 null、generation_prompt 必须为空；ready 且有多张参考图时 reference_analysis 必须逐图完整返回；plan_and_generate 时 plan 必填且 sections 返回 4-8 项；specialist_workflow 时 workflow_plan 必填并返回动态 4-12 个模块，汇总次数与积分必须等于模块之和；direct_generate/edit_image 时 generation_prompt 必须能脱离上下文直接执行。所有文案与选项必须由当前输入推导，禁止套用固定示例。"""


MODULE_REVISION_SYSTEM_PROMPT = """你是设计智能体的模块编辑复核器。用户已经修改了一个多模块视觉工作流中的模块。你的职责是保留用户修改意图，同时把内容优化成清晰、可执行、与整套工作流一致的模块说明和生图提示词。

硬性规则：
- 不得推翻或弱化用户刚提交的修改；只修正歧义、冲突、缺失的交付规格和不可执行表述。
- 必须结合原始 Brief、完整工作流和原模块理解上下文，但只返回当前模块。
- 不得编造用户未提供的产品型号、材质、尺寸、参数、认证、性能数据、品牌文案或促销信息；资料不足时写明“待补充”，不得猜测。
- 模块 id、预计生图次数和预计积分必须与原模块完全一致。
- generation_prompt 必须可以脱离上下文独立执行，并明确主体、构图、内容、视觉连续性、交付规格与禁止项。
- 除非用户明确要求无字图，generation_prompt 必须列出需要逐字排版的主标题、副标题和卖点短句，不得只要求预留文字区域。
- summary 说明做了哪些优化；cautions 只列仍需用户留意的真实风险，没有则返回空数组。

只返回一个 JSON 对象，不要 Markdown、解释或代码围栏：
{
  "module": {"id":"原模块ID","name":"优化后的模块名称","purpose":"优化后的目的","content":"优化后的主要内容","generation_prompt":"可独立执行的完整中文生图提示词","estimated_generation_count":1,"estimated_points":1},
  "summary": "本次优化说明",
  "cautions": ["仍需确认或补充的事项"]
}"""


REVIEW_SYSTEM_PROMPT = """你是 Product Fidelity 与 Quality Critic。必须查看随请求提供的实际生成图片，并逐项对照用户 Brief 和已批准设计方案进行复盘。多模块工作流的参考图1若被标记为产品身份基准，必须严格比对产品轮廓、结构、连接方式、颜色、材质、按键/开孔与收纳或充电结构；任一关键身份特征改变都必须判定 passed=false。多模块复核必须读取 plan.workflow_output.copy_mode：with_copy 时，批准文案缺失、不可读或不一致必须判定 passed=false，“只留空白区域”不算完成；without_copy 时，新增主标题、副标题、卖点、参数、徽章或促销标签必须判定 passed=false，但商品包装原有商标与标签不算违规。
若请求包含 workflow_peer_materials，说明这些图片是同一批工作流已经生成的其它模块，必须把当前结果与它们逐张对照，而不是只判断当前图片单独是否美观。checks 中必须包含名为“跨模块字体一致性”的独立检查，并基于可见证据比较标题字体类别与字形风格、字重、字宽、笔画装饰、描边/阴影和字距。允许字号因信息层级不同而变化，但没有在批准方案中明确说明时，衬线与无衬线、书法字与几何字、粗重展示字与纤细正文字等字体体系明显跳变，必须令该检查 passed=false，且整体 passed=false。还必须检查同批模块的主辅色、装饰语言、圆角/边框和信息层级是否属于同一视觉系统；明显不一致时同样不得通过。
随请求传图的固定顺序是：第 1 张为实际生成结果；之后依次为 reference_materials 中编号的原始参考图。必须为每一张原始参考图返回一项 reference_checks，逐张对照主体数量、商品身份、包装/外形、品牌元素和用户指定构图，并在 evidence 中写出生成结果里对应物的位置与可见特征；不能用“商品齐全”“全部包含”等总括句代替逐项证据。若某项无法在生成结果中明确定位，verdict 必须为 missing 或 unclear。若“全部、全家福、组合展示”遗漏任一不同商品，或把多个独立商品错误合并，passed 必须为 false，并在 checks、conclusion 和 suggestions 中明确指出遗漏项。没有原始参考图时才只依据 Brief 与方案检查。
只返回一个 JSON 对象，不要 Markdown、解释或代码围栏。不得因为图片已生成就默认通过；看不清、文字错误、规格不符或与方案偏离时必须如实指出。
JSON 结构：
{
  "title": "基于实际结果的完成状态标题",
  "summary": "对成图整体表现的具体判断",
  "overall_score": 0,
  "passed": false,
  "highlights": [{"title":"真实可见的亮点","detail":"画面证据与价值"}],
  "checks": [{"label":"与本任务相关的检查项","passed":true,"score":0,"detail":"基于实际图片的证据或问题"}],
  "reference_checks": [{"reference_index":1,"verdict":"present|same_subject_view_covered|missing|unclear|not_required","evidence":"生成结果中对应物的具体位置、外形与识别证据"}],
  "conclusion": "是否可交付以及最优先的下一步",
  "suggestions": [{"label":"短动作名称","instruction":"把当前图片作为参考时可直接执行的完整修改指令"}]
}
highlights 返回 2-6 项，checks 返回 4-9 项，suggestions 返回 2-5 项。建议必须依据实际图片和检查结果动态生成，不能照抄固定动作。"""


MARKER_RECOGNITION_SYSTEM_PROMPT = """你是画布标记区域的视觉识别器。用户在一张设计图上点击了一个具体位置。随请求提供的识别图分为三栏：左侧是完整设计缩略图，用于理解整体语境；中间是该坐标附近不带标记的清晰局部图，用于完整读取文字或物体；右侧是同一局部图，蓝色定位环中心就是用户点击的精确位置。定位环只是界面提示，不属于原设计。

只返回一个 JSON 对象，不要 Markdown、解释或代码围栏：
{
  "label": "2-12 个汉字的具体名称",
  "description": "一句话说明该坐标处实际看见的内容；若是文字，必须同时写出完整连续标题或词组"
}

命名规则：
- 必须结合左侧全图语境、中间无标记局部图与右侧精确坐标识别真实内容，不得返回“标记1”“区域”“图片”“元素”等泛化名称。
- 若落点是可辨认文字，先判断该字所属的连续标题、词组或同一排文字；label 必须返回完整可读词组，例如点击“家”也应返回“家国同庆”，点击“盛”应返回“双节盛惠”。只有画面中确实是孤立单字时才返回一个字。
- 如果文字具有多行或竖排关系，按视觉上的标题分组返回完整语义，例如两行“家国 / 同庆”仍应合并为“家国同庆”，不要只识别最靠近定位环的一个字。
- 若落点是物体，label 使用具体名词，例如“龙舟”“礼盒”“粽子”“月亮”“建筑”。
- 必须以蓝色定位环中心覆盖的像素为第一判断依据，而不是命名裁切图中面积最大的背景。
- 若落点位于物体边缘，优先命名蓝色定位环直接指向的主体。
- 中间无标记局部图会保留比单个字符更宽的上下文，识别文字时要沿同一基线、同一竖排或同一标题组读取完整语义，不要把一个标题拆成单字。
- 不确定时也要给出最具体的可见类别，例如“金色标题”或“紫色祥云”，不要编造画面外信息。"""


def plan_user_message(payload: WorkbenchPlanRequest) -> str:
    return json.dumps(
        {
            "brief": payload.message,
            "canvas_id": payload.canvas_id,
            "session_id": payload.session_id,
            "turn_id": payload.turn_id,
            "parent_turn_id": payload.parent_turn_id,
            "mode_hint": payload.mode_hint,
            "skill": payload.skill,
            "brand_kit": payload.brand_kit,
            "reference_materials": [
                {"index": index, "label": f"参考图{index}", "name": item.name}
                for index, item in enumerate(payload.reference_images, start=1)
            ],
            "reference_count": len(payload.reference_images),
            "has_reference_images": bool(payload.reference_images),
            "selected_assets": payload.selected_assets,
            "prior_turns": payload.prior_turns[-6:],
            "previous_plan": payload.previous_plan,
            "previous_review": payload.previous_review,
            "clarification_id": payload.clarification_id,
            "clarification_answers": [
                item.model_dump() if hasattr(item, "model_dump") else item.dict()
                for item in payload.clarification_answers
            ],
            "skip_clarification": payload.skip_clarification,
        },
        ensure_ascii=False,
    )


def module_revision_user_message(payload: WorkbenchWorkflowModuleRevisionRequest) -> str:
    return json.dumps(
        {
            "brief": payload.message,
            "skill": payload.skill,
            "workflow_plan": payload.workflow_plan,
            "original_module": payload.original_module.model_dump()
            if hasattr(payload.original_module, "model_dump") else payload.original_module.dict(),
            "user_edited_module": payload.edited_module.model_dump()
            if hasattr(payload.edited_module, "model_dump") else payload.edited_module.dict(),
        },
        ensure_ascii=False,
    )


def validate_module_revision(
    revision: WorkbenchWorkflowModuleRevision,
    payload: WorkbenchWorkflowModuleRevisionRequest,
):
    original = payload.original_module
    module = revision.module
    if module.id != original.id:
        raise ValueError("模块优化不得改变模块 ID")
    if module.estimated_generation_count != original.estimated_generation_count:
        raise ValueError("模块优化不得改变预计生图次数")
    if module.estimated_points != original.estimated_points:
        raise ValueError("模块优化不得改变预计积分")
    return revision


def validate_routing_decision(decision: WorkbenchRoutingDecision, payload: WorkbenchPlanRequest):
    if decision.status == "needs_clarification":
        if payload.clarification_answers or payload.skip_clarification:
            raise ValueError("模型在用户完成澄清后仍要求追问")
        if decision.route != "clarify" or decision.clarification is None:
            raise ValueError("澄清路径缺少动态问题")
        if decision.plan is not None or decision.workflow_plan is not None or decision.generation_prompt.strip():
            raise ValueError("澄清路径不得携带可执行方案或生成提示词")
        question_ids = [item.id for item in decision.clarification.questions]
        if len(question_ids) != len(set(question_ids)):
            raise ValueError("澄清问题 ID 重复")
        for question in decision.clarification.questions:
            option_ids = [item.id for item in question.options]
            if len(option_ids) != len(set(option_ids)):
                raise ValueError(f"澄清问题 {question.id} 的选项 ID 重复")
            if question.recommended_option_id and question.recommended_option_id not in option_ids:
                raise ValueError(f"澄清问题 {question.id} 的推荐选项不存在")
        return decision
    if decision.route == "clarify":
        raise ValueError("ready 状态不能分配到澄清路径")
    if decision.route == "plan_and_generate" and decision.plan is None:
        raise ValueError("完整设计路径缺少设计方案")
    specialist_requested = payload.skill in {"商品详情页", "Product Detail Page"} or "详情页" in payload.message
    if specialist_requested and decision.route != "specialist_workflow":
        raise ValueError("商品详情页或多模块详情页请求必须返回 specialist_workflow")
    if decision.route == "specialist_workflow":
        workflow = decision.workflow_plan
        if workflow is None:
            raise ValueError("多模块工作流缺少 workflow_plan")
        module_ids = [item.id for item in workflow.modules]
        if len(module_ids) != len(set(module_ids)):
            raise ValueError("workflow_plan 模块 ID 重复")
        generation_count = sum(item.estimated_generation_count for item in workflow.modules)
        estimated_points = sum(item.estimated_points for item in workflow.modules)
        if workflow.estimated_generation_count != generation_count:
            raise ValueError("workflow_plan 预计生图次数与模块汇总不一致")
        if workflow.estimated_points != estimated_points:
            raise ValueError("workflow_plan 预计积分与模块汇总不一致")
    if decision.route in {"direct_generate", "edit_image"} and len(decision.generation_prompt.strip()) < 20:
        raise ValueError("直接执行路径缺少完整执行提示词")
    if decision.route == "edit_image" and not (payload.reference_images or payload.selected_assets):
        raise ValueError("没有参考图时不能分配到图片修改路径")
    reference_count = len(payload.reference_images)
    if reference_count > 1:
        expected_indices = set(range(1, reference_count + 1))
        actual_indices = [item.reference_index for item in decision.reference_analysis]
        if len(actual_indices) != reference_count or set(actual_indices) != expected_indices:
            raise ValueError(
                f"reference_analysis 必须逐项覆盖参考图1至参考图{reference_count}，不得遗漏或重复"
            )
        execution_prompt = (
            decision.plan.generation_prompt
            if decision.route == "plan_and_generate" and decision.plan is not None
            else "\n".join(item.generation_prompt for item in decision.workflow_plan.modules)
            if decision.route == "specialist_workflow" and decision.workflow_plan is not None
            else decision.generation_prompt
        )
        missing_labels = [
            f"参考图{index}" for index in sorted(expected_indices)
            if f"参考图{index}" not in execution_prompt
        ]
        if missing_labels:
            raise ValueError(f"执行提示词未逐项说明：{'、'.join(missing_labels)}")
        by_index = {item.reference_index: item for item in decision.reference_analysis}
        for item in decision.reference_analysis:
            if item.relationship == "independent_subject" and not item.must_appear:
                raise ValueError(f"参考图{item.reference_index}被判定为独立商品时 must_appear 必须为 true")
            if item.relationship == "same_subject_view":
                grouped = item.grouped_with_reference_index
                if grouped is None or grouped == item.reference_index or grouped not in by_index:
                    raise ValueError(f"参考图{item.reference_index}的同商品视角关系缺少有效归组对象")
    return decision


def validate_result_review(review: WorkbenchResultReview, payload: WorkbenchReviewRequest):
    if payload.workflow_reference_images:
        typography_checks = [
            item for item in review.checks
            if "跨模块字体一致性" in item.label
        ]
        if not typography_checks:
            raise ValueError("多模块复核必须包含“跨模块字体一致性”检查")
        if any(not item.passed for item in typography_checks) and review.passed:
            raise ValueError("跨模块字体不一致时整体复核不得通过")
    reference_count = len(payload.reference_images)
    if not reference_count:
        return review
    expected_indices = set(range(1, reference_count + 1))
    actual_indices = [item.reference_index for item in review.reference_checks]
    if len(actual_indices) != reference_count or set(actual_indices) != expected_indices:
        raise ValueError(
            f"reference_checks 必须逐项覆盖参考图1至参考图{reference_count}，不得遗漏或重复"
        )
    plan_reference_analysis = payload.plan.get("reference_analysis") if isinstance(payload.plan, dict) else []
    required_indices = {
        int(item.get("reference_index") or 0)
        for item in (plan_reference_analysis or [])
        if isinstance(item, dict) and item.get("must_appear") is True
    }
    unresolved = [
        item for item in review.reference_checks
        if item.verdict in {"missing", "unclear"}
        or (item.reference_index in required_indices and item.verdict == "not_required")
    ]
    if unresolved and review.passed:
        labels = "、".join(f"参考图{item.reference_index}" for item in unresolved)
        raise ValueError(f"{labels}未确认出现在成图中时，质量复核不得通过")
    return review


def review_user_message(payload: WorkbenchReviewRequest) -> str:
    plan = dict(payload.plan or {})
    return json.dumps(
        {
            "brief": payload.message,
            "skill": payload.skill,
            "image_name": payload.image_name,
            "generated_image_index": 1,
            "reference_materials": [
                {"image_index": index + 1, "label": f"参考图{index}", "name": item.name}
                for index, item in enumerate(payload.reference_images, start=1)
            ],
            "reference_count": len(payload.reference_images),
            "workflow_peer_materials": [
                {
                    "image_index": len(payload.reference_images) + index + 1,
                    "label": f"同批模块{index}",
                    "name": item.name,
                    "instruction": "用于核对字体、配色、装饰语言和版式体系，不是产品身份参考图",
                }
                for index, item in enumerate(payload.workflow_reference_images, start=1)
            ],
            "workflow_peer_count": len(payload.workflow_reference_images),
            "approved_plan": plan or None,
        },
        ensure_ascii=False,
    )


def marker_recognition_user_message(payload: WorkbenchMarkerRecognitionRequest) -> str:
    return json.dumps(
        {
            "marker_region_label": True,
            "target_name": payload.target_name,
            "marker_number": payload.marker_number,
            "original_coordinate": {
                "x_percent": payload.x_percent,
                "y_percent": payload.y_percent,
            },
            "instruction": "结合左侧全图、中间无标记局部图和右侧蓝色定位环中心识别实际视觉内容。若命中文字，沿同一排或同一竖列返回完整连续标题或词组，不要只返回光标下的单个字；名称只读且不可编辑。",
        },
        ensure_ascii=False,
    )


AnalysisModel = TypeVar("AnalysisModel", bound=BaseModel)


def parse_analysis(text: str, model: Type[AnalysisModel]) -> AnalysisModel:
    value = parse_json_object(text)
    if not value:
        raise ValueError("模型没有返回 JSON 对象")
    try:
        if hasattr(model, "model_validate"):
            return model.model_validate(value)
        return model.parse_obj(value)
    except Exception as exc:
        raise ValueError(f"模型返回的结构不完整：{exc}") from exc
