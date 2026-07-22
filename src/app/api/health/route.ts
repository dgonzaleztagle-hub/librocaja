import { NextResponse } from "next/server";
export function GET() { return NextResponse.json({ status: "ok", service: "caja-clara", time: new Date().toISOString() }); }

