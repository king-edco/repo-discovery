import withSerwistInit from "@serwist/next";
import type { NextConfig } from "next";

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === "development",
});

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@huggingface/transformers", "onnxruntime-node"],
  allowedDevOrigins: [
    "work-1-tnbtljnnujksftmu.prod-runtime.all-hands.dev",
    "work-2-tnbtljnnujksftmu.prod-runtime.all-hands.dev",
  ],
};

export default withSerwist(nextConfig);
