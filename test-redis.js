import Redis from "ioredis";

const redis = new Redis("rediss://default:Aa5gAAIjcDEyMTRhOTIwNDYwYzQ0MWY4YWI5NmVkMTg5NzViYzUwY3AxMA@sharing-guppy-44640.upstash.io:6379");

async function test() {
  await redis.set("ping", "pong");
  const res = await redis.get("ping");
  console.log("Redis respondeu:", res);
  await redis.quit();
}

test().catch(console.error);
