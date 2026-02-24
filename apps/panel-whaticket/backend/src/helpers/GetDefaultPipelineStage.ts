import PipelineStage from "../models/PipelineStage";

export default async function GetDefaultPipelineStage(): Promise<PipelineStage | null> {
  const stage = await PipelineStage.findOne({
    where: { isDefault: true },
    order: [["order", "ASC"]]
  });

  if (stage) return stage;
  // fallback: first by order
  return PipelineStage.findOne({ order: [["order", "ASC"]] });
}
