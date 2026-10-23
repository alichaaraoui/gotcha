// OWNER: Person 2
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/github";
import adzuna from "@/data/adzuna_cache.json";
import type { MarketDemand, ProfileRequest } from "@/lib/types";

export async function POST(req: Request) {
  const body = (await req.json()) as ProfileRequest;
  const profile = await getProfile(body.login.trim() || "demo-candidate");
  const roles = adzuna.roles as Record<string, MarketDemand>;
  return NextResponse.json({ ...profile, linkedinUrl: body.linkedinUrl, marketDemand: roles[body.role] });
}
