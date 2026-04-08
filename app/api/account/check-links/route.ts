import { NextResponse } from "next/server";

type SafeBrowsingMatch = {
  threatType?: string;
  platformType?: string;
  threat?: {
    url?: string;
  };
};

function stripTrackingParams(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const paramsToDelete = Array.from(url.searchParams.keys()).filter(
      (key) =>
        key.toLowerCase().startsWith("utm_") ||
        key.toLowerCase() === "fbclid" ||
        key.toLowerCase() === "gclid"
    );

    for (const key of paramsToDelete) {
      url.searchParams.delete(key);
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
}

function looksLikeTrackingPixel(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    const width = url.searchParams.get("w") ?? url.searchParams.get("width");
    const height = url.searchParams.get("h") ?? url.searchParams.get("height");
    const pathname = url.pathname.toLowerCase();

    return (
      pathname.includes("pixel") ||
      pathname.includes("open") ||
      pathname.includes("track") ||
      pathname.includes("1x1") ||
      (width === "1" && height === "1")
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  try {
    const apiKey = process.env.GOOGLE_SAFE_BROWSING_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ matches: [], skipped: true });
    }

    const payload = (await request.json()) as { urls?: string[] };
    const rawUrls = Array.isArray(payload.urls) ? payload.urls : [];

    if (rawUrls.length > 50) {
      return NextResponse.json(
        { error: "A maximum of 50 URLs may be checked at once." },
        { status: 400 }
      );
    }

    const urls = Array.from(
      new Set(
        rawUrls
          .map((url) => url.trim())
          .filter(Boolean)
          .filter((url) => !/^mailto:/i.test(url))
          .map(stripTrackingParams)
          .filter((url) => !looksLikeTrackingPixel(url))
      )
    );

    if (urls.length === 0) {
      return NextResponse.json({ matches: [] });
    }

    const response = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          client: {
            clientId: "mmwbmail",
            clientVersion: "1.0"
          },
          threatInfo: {
            threatTypes: [
              "MALWARE",
              "SOCIAL_ENGINEERING",
              "UNWANTED_SOFTWARE",
              "POTENTIALLY_HARMFUL_APPLICATION"
            ],
            platformTypes: ["ANY_PLATFORM"],
            threatEntryTypes: ["URL"],
            threatEntries: urls.map((url) => ({ url }))
          }
        })
      }
    );

    if (!response.ok) {
      const message = await response.text();
      return NextResponse.json(
        { error: message || "Unable to check links." },
        { status: 502 }
      );
    }

    const data = (await response.json()) as { matches?: SafeBrowsingMatch[] };
    return NextResponse.json({ matches: data.matches ?? [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to check links.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
