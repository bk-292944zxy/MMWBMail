import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { isEspDomain } from "@/lib/sender-verification";

type DnsAnswer = {
  data?: string;
};

type DnsJsonResponse = {
  Answer?: DnsAnswer[];
};

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//i, "")
    .split("/")[0]
    ?.split("@")
    .pop()
    ?.split(":")[0]
    ?.replace(/\.$/, "") ?? "";
}

function parseTxtRecord(record: string) {
  const quotedParts = Array.from(record.matchAll(/"([^"]*)"/g)).map((match) => match[1]);
  if (quotedParts.length > 0) {
    return quotedParts.join("");
  }

  return record.replace(/^"|"$/g, "");
}

async function fetchDnsTxtRecords(name: string) {
  const response = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`,
    {
      headers: {
        Accept: "application/dns-json"
      },
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error(`DNS lookup failed for ${name}`);
  }

  const data = (await response.json()) as DnsJsonResponse;
  return (data.Answer ?? [])
    .map((answer) => answer.data)
    .filter((value): value is string => Boolean(value))
    .map(parseTxtRecord);
}

async function lookupDmarc(domain: string) {
  const records = await fetchDnsTxtRecords(`_dmarc.${domain}`);
  const dmarcRecord = records.find((record) => /v=DMARC1/i.test(record));
  if (!dmarcRecord) {
    return "absent";
  }

  return dmarcRecord.match(/(?:^|;\s*)p=([^;\s]+)/i)?.[1]?.toLowerCase() ?? "absent";
}

async function lookupBimi(domain: string) {
  const records = await fetchDnsTxtRecords(`default._bimi.${domain}`);
  const bimiRecord = records.find((record) => /v=BIMI1/i.test(record));

  if (!bimiRecord) {
    return { bimiVerified: false, bimiLogoUrl: null as string | null };
  }

  const logoUrl = bimiRecord.match(/(?:^|;\s*)l=([^;\s]+)/i)?.[1] ?? null;
  const authorityUrl = bimiRecord.match(/(?:^|;\s*)a=([^;\s]+)/i)?.[1] ?? null;

  return {
    bimiVerified: Boolean(authorityUrl),
    bimiLogoUrl: logoUrl
  };
}

async function lookupSpf(domain: string) {
  const records = await fetchDnsTxtRecords(domain);
  return records.some((record) => /v=spf1/i.test(record));
}

async function lookupTrancoRank(domain: string) {
  const hasSync = await prisma.trancoSync.findFirst({
    orderBy: { syncedAt: "desc" },
    select: { id: true }
  });

  if (!hasSync) {
    return null;
  }

  const parts = domain.split(".").filter(Boolean);
  const candidates = parts.map((_, index) => parts.slice(index).join("."));

  const cached = await prisma.domainVerificationCache.findMany({
    where: {
      domain: {
        in: candidates
      }
    },
    select: {
      domain: true,
      trancoRank: true
    }
  });

  const cachedMap = new Map(
    cached.map((entry) => [entry.domain, entry.trancoRank] as const)
  );

  for (const candidate of candidates) {
    const rank = cachedMap.get(candidate);
    if (rank != null) {
      return rank;
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { domain?: string };
    const domain = normalizeDomain(body.domain ?? "");

    if (!domain) {
      return NextResponse.json({ error: "Domain is required." }, { status: 400 });
    }

    const cached = await prisma.domainVerificationCache.findUnique({
      where: { domain }
    });

    if (cached && Date.now() - cached.cachedAt.getTime() < 24 * 60 * 60 * 1000) {
      return NextResponse.json(cached);
    }

    const results = await Promise.allSettled([
      lookupDmarc(domain),
      lookupBimi(domain),
      lookupSpf(domain),
      lookupTrancoRank(domain),
      Promise.resolve(isEspDomain(domain))
    ]);

    const existing = cached ?? null;
    const dmarcPolicy =
      results[0].status === "fulfilled"
        ? results[0].value
        : existing?.dmarcPolicy ?? null;
    const bimiVerified =
      results[1].status === "fulfilled"
        ? results[1].value.bimiVerified
        : existing?.bimiVerified ?? false;
    const bimiLogoUrl =
      results[1].status === "fulfilled"
        ? results[1].value.bimiLogoUrl
        : existing?.bimiLogoUrl ?? null;
    const spfPresent =
      results[2].status === "fulfilled"
        ? results[2].value
        : existing?.spfPresent ?? false;
    const trancoRank =
      results[3].status === "fulfilled"
        ? results[3].value
        : existing?.trancoRank ?? null;
    const isEsp =
      results[4].status === "fulfilled" ? results[4].value : existing?.isEsp ?? false;

    const record = await prisma.domainVerificationCache.upsert({
      where: { domain },
      create: {
        domain,
        dmarcPolicy,
        bimiVerified,
        bimiLogoUrl,
        spfPresent,
        trancoRank,
        isEsp,
        cachedAt: new Date()
      },
      update: {
        dmarcPolicy,
        bimiVerified,
        bimiLogoUrl,
        spfPresent,
        trancoRank,
        isEsp,
        cachedAt: new Date()
      }
    });

    return NextResponse.json(record);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to verify sender domain.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
