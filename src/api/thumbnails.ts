import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";

import path from 'node:path';

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024;

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const thumbnail = formData.get("thumbnail");
  if (!(thumbnail instanceof File)) throw new BadRequestError("Invalid thumbnail object. Must be a file.");

  const mediaType = thumbnail.type;

  const arrayBuffer = await thumbnail.arrayBuffer();

  const video = getVideo(cfg.db, videoId);
  if (!video) throw new NotFoundError("Couldn't find video");
  if (video.userID != userID) throw new UserForbiddenError("User is not authenticated");

  const fileExtension = mediaType.split("/")[1];
  const filePath = path.join(cfg.assetsRoot, `${video.id}.${fileExtension}`);
  await Bun.write(filePath, thumbnail);

  video.thumbnailURL = `http://localhost:${cfg.port}/assets/${video.id}.${fileExtension}`;
  updateVideo(cfg.db, video);

  return respondWithJSON(200, video);
}
