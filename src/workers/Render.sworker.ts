import { NALUStream, SPS } from "../lib/h264-utils";
import { getNalus, identifyNaluStreamInfo, NaluStreamInfo, NaluTypes } from "../lib/utils";
import {
  InitRenderEvent,
  RenderDomeEvent as RenderDoneEvent,
  RenderEvent,
  StatusEvent,
  WorkerEvent,
} from "./RenderEvents";
import { WebGLRenderer } from "./WebGLRenderer";


export type StatusType = "render" | "decode";
type PartialRecord<K extends string, T> = Partial<Record<K, T>>;
export type StatusUpdate = PartialRecord<StatusType, string>;

const scope = self as unknown as Worker;

type HostType = Window & typeof globalThis;

type WorkerInterface = Worker & {
  new (): Worker;
};

export default {} as WorkerInterface;


export class RenderWorker {
  constructor(private host: HostType) {}

  private renderer: { draw(data: VideoFrame): void } | null = null;
  private pendingFrame: VideoFrame | null = null;
  private startTime: number | null = null;
  private frameCount = 0;
  private timestamp = 0;

  private pendingStatus: StatusUpdate | null = null;
  private naluStreamInfo: NaluStreamInfo | null = null;

  private setStatus(type: StatusType, message: string) {
    if (this.pendingStatus) {
      this.pendingStatus[type] = message;
    } else {
      this.pendingStatus = { [type]: message };

      this.host.requestAnimationFrame(this.statusAnimationFrame.bind(this));
    }
  }

  private statusAnimationFrame() {
    if (this.pendingStatus) {
      this.host.postMessage(new StatusEvent(this.pendingStatus));
    }

    this.pendingStatus = null;
    this.host.postMessage(new RenderDoneEvent());
  }

  private onVideoDecoderOutput(frame: VideoFrame) {
    // Update statistics.
    if (this.startTime == null) {
      this.startTime = performance.now();
    } else {
      const elapsed = (performance.now() - this.startTime) / 1000;
      const fps = ++this.frameCount / elapsed;
      this.setStatus("render", `${fps.toFixed(0)}`);
    }

    // Schedule the frame to be rendered.
    this.renderFrame(frame);
  }

  private renderFrame(frame: VideoFrame) {
    if (!this.pendingFrame) {
      // Schedule rendering in the next animation frame.
      requestAnimationFrame(this.renderAnimationFrame.bind(this));
    } else {
      // Close the current pending frame before replacing it.
      this.pendingFrame.close();
    }
    // Set or replace the pending frame.
    this.pendingFrame = frame;
  }

  private renderAnimationFrame() {
    if (this.pendingFrame) {
      this.renderer?.draw(this.pendingFrame);
      this.pendingFrame = null;
    }
  }

  private onVideoDecoderOutputError(err: Error) {
    this.setStatus("decode", err.message);
    console.error(`H264 Render worker decoder error`, err);
  }

  private getNaluStreamInfo(imgData: Uint8Array) {
    if (this.naluStreamInfo == undefined) {
      const streamInfo = identifyNaluStreamInfo(imgData);
      if (streamInfo.type !== "unknown") {
        this.naluStreamInfo = streamInfo;
        console.debug(
          `Stream identified as ${streamInfo.type} with box size: ${streamInfo.boxSize}`,
        );
      }
    }
    return this.naluStreamInfo;
  }

  // Set up a VideoDecoer.
  private decoder = new VideoDecoder({
    // We got a frame
    output: this.onVideoDecoderOutput.bind(this),
    error: this.onVideoDecoderOutputError.bind(this),
  });

  private getAnnexBFrame(frameData: Uint8Array) {
    const streamInfo = this.getNaluStreamInfo(frameData);
    if (streamInfo?.type === "packet") {
      const res = new NALUStream(frameData, {
        type: "packet",
        boxSize: streamInfo.boxSize,
      }).convertToAnnexB().buf;
      return res;
    }
    return frameData;
  }

  init(event: InitRenderEvent) {
    this.renderer = new WebGLRenderer("webgl", event.canvas);
  }

  onFrame(event: RenderEvent) {
    // the decoder, as it is configured, expects 'annexB' style h264 data.
    const frame = this.getAnnexBFrame(new Uint8Array(event.frameData));
    if (this.decoder.state === "unconfigured") {
      const decoderConfig = this.getDecoderConfig(frame);
      if (decoderConfig) {
        this.decoder.configure(decoderConfig);
      }
    }
    if (this.decoder.state === "configured") {
      const keyframe = this.isKeyFrame(new Uint8Array(event.frameData)) ? "key" : "delta";

      try {
        this.decoder.decode(
          new EncodedVideoChunk({
            type: keyframe,
            data: frame,
            timestamp: this.timestamp++,
          }),
        );
      } catch (e) {
        console.error(`H264 Render Workerd ecode error`, e);
      }
    }
  }

  private getDecoderConfig(frameData: Uint8Array): VideoDecoderConfig | null {
    const nalus = getNalus(frameData);
    const spsNalu = nalus.find((n) => n.type === NaluTypes.SPS);
    if (spsNalu) {
      const sps = new SPS(spsNalu.nalu.nalu);
      const decoderConfig: VideoDecoderConfig = {
        codec: sps.MIME,
        codedHeight: sps.picHeight,
        codedWidth: sps.picWidth,
      };
      return decoderConfig;
    }
    return null;
  }

  private isKeyFrame(frameData: Uint8Array): boolean {
    const nalus = getNalus(frameData);
    return nalus.find((n) => n.type === NaluTypes.IDR) != undefined;
  }
}

// Create a worker instance and subscribe to message event from the host.
const worker = new RenderWorker(self);
scope.addEventListener("message", (event: MessageEvent<WorkerEvent>) => {
  if (event.data.type === "init") {
    worker.init(event.data as InitRenderEvent);
  } else if (event.data.type === "frame") {
    worker.onFrame(event.data as RenderEvent);
  }
});

