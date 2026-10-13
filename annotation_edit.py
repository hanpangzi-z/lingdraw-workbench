"""Explicit reference roles for drawing annotations, shared by image providers."""
from fastapi import HTTPException


def is_drawing_reference(reference):
    if not isinstance(reference, dict):
        return False
    role = str(reference.get("role") or "").strip().lower()
    return role in {"annotation", "sketch"} or (role == "source" and bool(reference.get("annotation_group")))


def has_annotation_references(references):
    return any(isinstance(ref, dict) and (
        ref.get("annotation_group") or str(ref.get("role") or "").strip().lower() == "annotation"
    ) for ref in (references or []))


def prepare_annotation_edit(prompt, references):
    if not has_annotation_references(references):
        return prompt, references
    grouped = [ref for ref in references if ref.get("annotation_group") or str(ref.get("role") or "").strip().lower() == "annotation"]
    groups = {str(ref.get("annotation_group") or "") for ref in grouped}
    source = [ref for ref in grouped if ref.get("role") == "source"]
    guide = [ref for ref in grouped if ref.get("role") == "annotation"]
    if (len(groups) != 1 or "" in groups or len(grouped) != 2 or len(source) != 1 or len(guide) != 1
            or not source[0].get("url") or not guide[0].get("url") or source[0]["url"] == guide[0]["url"]):
        raise HTTPException(status_code=400, detail="标注改图需要一组完整的原图和标注说明图，请从绘画标注重新导入。")
    if any(str(ref.get("role") or "").lower() == "mask" or str(ref.get("name") or "").lower().endswith("_mask.png") for ref in references):
        raise HTTPException(status_code=400, detail="标注改图暂不能与蒙版附件混用，请移除蒙版后重试。")
    if not str(prompt or "").strip():
        raise HTTPException(status_code=400, detail="请填写具体修改要求。")
    # Put the complete pair first, including when other attachments predate it.
    ordered = source + guide + [ref for ref in references if ref not in grouped]
    contract = (
        "【标注改图：输入图片用途】\n"
        "图片1是干净原图，是唯一需要修改的作品。以它的真实内容、材质、构图和画质为基础。\n"
        "图片2是带标注的修改示意图，仅用于理解修改位置和要求，不是另一张待合成的作品。"
        "其中新增的箭头、圈线、涂画、编号、文字标签均为编辑说明，不得直接绘制进成品。"
        "示意图可能包含画布留白、其他参考图片或不同缩放，这些都不是原图内容。\n"
        "如果还有图片3及之后的图片，它们只作为用户要求的辅助参考，不自动合并到作品中。\n"
        "执行下面的文字修改要求，结合示意图定位；没有明确修改含义的圈线不能自行推断为删除或替换。"
        "原图本身已有的文字、图案和标识应保留，除非用户明确要求修改。"
        "只有用户明确指定应出现在成品中的文字或图形才属于输出内容。"
        "尽量保持未指定修改区域的内容、光影和细节。只输出修改后的成品，不输出标注图、对比图或说明面板。\n\n"
        "【用户修改要求】\n"
    )
    return contract + str(prompt).strip(), ordered
