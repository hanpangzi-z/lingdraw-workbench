import { afterEach, describe, expect, it, vi } from "vitest";
import { generateProductImage, pollImageJob } from "@/src/lib/ai/generateProductImageClient";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const input = { prompt: "场景", productName: "商品", referenceImages: [], aspectRatio: 1, providerId: "configured", model: "image-model" };
describe("asynchronous PPT image client", () => {
  it.each([401,403,409])("retains uncertain jobs on HTTP %s without generating twice", async status => {
    const fetch = vi.fn(async () => Response.json({error:'access or conflict'}, {status})); vi.stubGlobal('fetch',fetch);
    await expect(generateProductImage(input)).rejects.toMatchObject({stopPolling:true}); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("never applies a result bearing a different job ID", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({jobId:'different',status:'succeeded',result:{imageUrl:'/wrong-user-image'}})));
    await expect(pollImageJob('expected')).rejects.toThrow('任务编号不匹配');
  });
  it("keeps unknown status instead of inviting another paid generation", async () => {
    const fetch=vi.fn(async () => Response.json({status:'unknown',error:'upstream unknown'}));vi.stubGlobal('fetch',fetch);
    await expect(pollImageJob('test')).rejects.toMatchObject({stopPolling:true});expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("exposes an explicit terminal failure", async () => {
    vi.stubGlobal('fetch',vi.fn(async () => Response.json({status:'failed',error:'invalid model'})));
    await expect(pollImageJob('test')).rejects.toThrow('invalid model');
  });
  it("takes a short acknowledgement and polls until the original job succeeds", async () => {
    vi.useFakeTimers(); let gets = 0;
    const fetch = vi.fn(async (_url, options) => options?.method === "POST"
      ? Response.json({ jobId: (options.body as FormData).get("jobId"), status: "queued" }, { status: 202 })
      : Response.json(++gets === 1 ? { status: "generating" } : { status: "succeeded", result: { imageUrl: "/ppt/api/assets/result/content" } }));
    vi.stubGlobal("fetch", fetch);
    const result = generateProductImage(input);
    const check = expect(result).resolves.toMatchObject({ imageUrl: "/ppt/api/assets/result/content" });
    await vi.advanceTimersByTimeAsync(6000); await check;
    expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
  it("recovers a 504 HTML response by querying the same job, not generating again", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(async (_url, options) => options?.method === "POST"
      ? new Response("<html>Gateway timeout</html>", { status: 504 })
      : Response.json({ status: "succeeded", result: { imageUrl: "/ppt/api/assets/recovered/content" } }));
    vi.stubGlobal("fetch", fetch);
    const result = generateProductImage(input);
    const check = expect(result).resolves.toMatchObject({ imageUrl: "/ppt/api/assets/recovered/content" });
    await vi.advanceTimersByTimeAsync(4000); await check;
    expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  });
});
