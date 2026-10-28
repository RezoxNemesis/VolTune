# VolTune connector. Build from the repository root:
#   docker build -f server/Dockerfile -t voltune-server .
#   docker run -p 7860:7860 -v voltune:/data voltune-server
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY src/engine ./src/engine
COPY server/package.json server/package-lock.json server/build.mjs server/tsconfig.json ./server/
COPY server/src ./server/src
WORKDIR /app/server
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app/server
ENV NODE_ENV=production PORT=7860 VOLTUNE_DATA=/data ONNXRUNTIME_NODE_INSTALL_CUDA=skip
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/package.json ./
# Fetch the model at build time so the container starts ready (≈330 MB; set VOLTUNE_PRECISION=int8 for ≈90 MB).
ARG VOLTUNE_PRECISION=fp32
ENV VOLTUNE_PRECISION=${VOLTUNE_PRECISION} VOLTUNE_MODEL=/app/model.onnx
ADD https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx /app/model.onnx
RUN mkdir -p /data && chown -R node:node /data /app
USER node
EXPOSE 7860
CMD ["node", "dist/mcp.js"]
