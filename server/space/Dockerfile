# Hugging Face Space (Docker SDK): put this file at the root of the Space repo, next to README.md from server/space.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
ARG REPO=https://github.com/RezoxNemesis/VolTune.git
ARG REF=main
RUN git clone --depth 1 --branch ${REF} ${REPO} /app
WORKDIR /app/server
ENV ONNXRUNTIME_NODE_INSTALL_CUDA=skip
RUN npm ci && npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app/server
ENV NODE_ENV=production PORT=7860 VOLTUNE_DATA=/data VOLTUNE_MODEL=/app/model.onnx
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
ADD https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx /app/model.onnx
RUN mkdir -p /data && chown -R 1000:1000 /data /app
USER 1000
EXPOSE 7860
CMD ["node", "dist/mcp.js"]
