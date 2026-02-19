import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";

import { getBearerToken, validateJWT } from "../auth";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import { getVideo, updateVideo } from "../db/videos";

const { randomBytes } = await import('node:crypto');
import path from 'node:path';

const MAX_UPLOAD_SIZE = 30 * 1024 * 1024;

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
  const fileContent = Bun.file(filePath)

  const s3File = cfg.s3Client.file(filePath);
  await s3File.write(fileContent, {type: mimeType});

  await Bun.file(filePath).delete();

  video.videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/assets/${fileName}.mp4`;
  updateVideo(cfg.db, video);
  return respondWithJSON(200, video);
}
