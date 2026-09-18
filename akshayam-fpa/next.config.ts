import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this directory.
  //
  // Turbopack otherwise infers the root by walking up for lockfiles, and the
  // app is deployed at /app/akshayam-fpa inside the repo checkout at /app. Any
  // stray package-lock.json left in /app - an `npm i` run one directory too
  // high is enough, and it survives `git reset --hard` because it is untracked
  // - makes it pick /app instead, widening the tree the build walks on a
  // 512 MB box. That is what timed out the 18 Sep deploy at the 20-minute mark.
  //
  // Naming the root here means a stray file up there cannot change how the
  // build behaves, rather than relying on nobody ever leaving one.
  turbopack: { root: path.join(__dirname) },
};

export default nextConfig;
