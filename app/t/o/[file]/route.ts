import { noteOpen, trackingPixel } from "@/lib/campaigns/public";

// The 1x1 picture in a campaign email: loading it counts an open. It always answers with the picture.
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  await noteOpen(file.replace(/\.gif$/i, ""));
  return trackingPixel();
}
