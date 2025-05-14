/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Enable static exports
  distDir: '.next',
  // Configure build output
  experimental: {
    outputFileTracingRoot: undefined, // Enable file tracing
  },
}

module.exports = nextConfig 