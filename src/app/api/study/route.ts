import { NextResponse } from "next/server";
import { connectToDatabase } from "../../../../lib/mongodb";
import { StudySession } from "../../../../models/model";

/**
 * Stores a participant's study session, whole, after every step.
 *
 * Upserted by participant id, so the same session sent again -- the next
 * step, or a retry -- replaces the record instead of adding one. There is no
 * GET: the sessions are read from the database by the researcher, and the
 * study page keeps its own copy in localStorage with a download at the end,
 * so a session machine without a database loses nothing.
 */
/** Said once per server run, not once per step of every session. */
let warnedNoDatabase = false;

export async function POST(req: Request) {
  try {
    const session = await req.json();
    if (
      !session ||
      typeof session !== "object" ||
      typeof session.participantId !== "string"
    ) {
      return NextResponse.json({ error: "Not a session" }, { status: 400 });
    }

    // A machine without a database -- a dev checkout, a session laptop -- is
    // a normal way to run the study: the page keeps every session in the
    // browser and offers it as a download. Say so once instead of failing
    // deep inside mongoose at every step.
    if (!process.env.MONGO_URI) {
      if (!warnedNoDatabase) {
        warnedNoDatabase = true;
        console.warn(
          "study: MONGO_URI is not set, so sessions are kept in the browser only (set it in .env to store them)",
        );
      }
      return NextResponse.json({ error: "No database" }, { status: 503 });
    }

    await connectToDatabase();
    await StudySession.findOneAndUpdate(
      { participantId: session.participantId },
      { data: session },
      { upsert: true },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Error saving the study session:", error);
    return NextResponse.json(
      { error: "Could not save the session" },
      { status: 500 },
    );
  }
}
