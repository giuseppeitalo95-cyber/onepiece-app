import type { NextConfig } from "next";

const brandedAssetHeaders = [
  "/opv-hat-cutout.png",
  "/opv-text-cutout.png",
  "/luffyhatlogo.webp",
  "/favicon-32.png",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
].map((source) => ({
  source,
  headers: [
    {
      key: "Cache-Control",
      value: "public, max-age=3600, stale-while-revalidate=86400",
    },
  ],
}));

const nextConfig: NextConfig = {
  async headers() {
    return [
      ...brandedAssetHeaders,
      {
        source: "/rewards/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/vendor/opencv-5.0.0.js",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
