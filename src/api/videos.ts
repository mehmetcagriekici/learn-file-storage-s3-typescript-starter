import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";

import { getBearerToken, validateJWT } from "../auth";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getVideo, updateVideo } from "../db/videos";

const { randomBytes } = await import('node:crypto');
import path from 'node:path';

const MAX_UPLOAD_SIZE = 1024 * 1024 * 1024;

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) throw new BadRequestError("Invalid video ID.");

  const token = getBearerToken(req.headers);
  const userId = validateJWT(token, cfg.jwtSecret);

  const video = getVideo(cfg.db, videoId);
  if (!video) throw new NotFoundError("Couldn't found the video.");
  if (video.userID != userId) throw new UserForbiddenError("User is forbidden from accessing the video.");

  const formData = await req.formData();
  const file = formData.get("video");
  if (file.size > MAX_UPLOAD_SIZE) throw new BadRequestError("File is too big.");

  const mimeType = file.type;
  if (mimeType != "video/mp4") throw new BadRequestError("File must be an mp4 file.");

  const buf = randomBytes(32);
  const fileName = buf.toString("base64url");
  const filePath = path.join(cfg.assetsRoot, `${fileName}.mp4`);
  
  await Bun.write(filePath, file);

  const processedPath = await processVideoForFastStart(filePath);

  await Bun.file(filePath).delete();
  
  const fileContent = Bun.file(processedPath);

  const aspectRatio = await getVideoAspectRatio(processedPath);
  
  const s3FilePath = path.join(aspectRatio, `${fileName}.mp4`);
  const s3File = cfg.s3Client.file(s3FilePath);
  await s3File.write(fileContent, {type: mimeType});

  await Bun.file(processedPath).delete();

  video.videoURL = `https://${cfg.s3CfDistribution}/${s3FilePath}`;
  updateVideo(cfg.db, video);
  return respondWithJSON(200, video);
}

async function getVideoAspectRatio(filePath: string) {
  const proc = Bun.spawn(["ffprobe",
			  "-v",
			  "error",
			  "-select_streams",
			  "v:0",
			  "-show_entries",
			  "stream=width,height",
			  "-of",
			  "json",
			  filePath,
			 ]);
  await proc.exited;
  if (proc.exitCode != 0) {
    const stderrText = await new Response(proc.stderr).text();
    throw new Error(stderrText);
  }

  const stdoutText = await new Response(proc.stdout).text();

  const parsed = JSON.parse(stdoutText);
  const streams = parsed["streams"][0];

  const aspect = streams["width"] / streams["height"];
  
  if (aspect > 1.6 && aspect < 1.9) {
    return "landscape";
  }

  if(aspect > 0.4 && aspect < 0.6) {
    return "portrait";
  }

  return "other";
}

async function processVideoForFastStart(inputFilePath: string) {
  const outputFilePath = inputFilePath + ".processed";
  
  const proc = Bun.spawn(["ffmpeg",
			  "-i",
			  inputFilePath,
			  "-movflags",
			  "faststart",
			  "-map_metadata",
			  "0",
			  "-codec",
			  "copy",
			  "-f",
			  "mp4",
			  outputFilePath,
			 ]);
  await proc.exited;
  return outputFilePath;
}
