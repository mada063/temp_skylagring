/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Allow multi-GB bodies for uploads (server actions + some route parsing).
    serverActions: {
      bodySizeLimit: "50gb",
    },
  },
};

export default nextConfig;
