import { NextResponse } from "next/server";

import {
  acquireAdminCronLock,
  authorizeAdminCronRequest
} from "@/lib/admin-cron";
import { prisma } from "@/lib/prisma";
import { BRAND_DOMAINS, extractSLD, findBrandBySld } from "@/lib/sender-verification";

const TRANC0_LIMIT = 100_000;
const UPSERT_CHUNK_SIZE = 500;

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }

  return chunks;
}

async function upsertBrandDomains(
  records: Array<{
    brand: string;
    domain: string;
    source: string;
  }>
) {
  for (const chunk of chunkArray(records, UPSERT_CHUNK_SIZE)) {
    await prisma.$transaction(
      chunk.map((record) =>
        prisma.brandDomain.upsert({
          where: {
            brand_domain: {
              brand: record.brand,
              domain: record.domain
            }
          },
          create: record,
          update: {
            source: record.source
          }
        })
      )
    );
  }
}

export async function GET(request: Request) {
  const unauthorizedResponse = authorizeAdminCronRequest(request);
  if (unauthorizedResponse) {
    return unauthorizedResponse;
  }

  const releaseLock = acquireAdminCronLock("sync-tranco");
  if (!releaseLock) {
    return NextResponse.json(
      { error: "Tranco sync is already running." },
      { status: 409 }
    );
  }

  try {
    const response = await fetch("https://tranco-list.eu/download/ranked/full", {
      cache: "no-store",
      signal: AbortSignal.timeout(30_000)
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Unable to fetch the Tranco list." },
        { status: 503 }
      );
    }

    const csv = await response.text();
    const parsedDomains = csv
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(0, TRANC0_LIMIT)
      .map((line) => {
        const [rankValue, domainValue] = line.split(",");
        return {
          rank: Number(rankValue),
          domain: domainValue?.trim().toLowerCase() ?? ""
        };
      })
      .filter((entry) => Number.isFinite(entry.rank) && Boolean(entry.domain));

    const now = new Date();
    const hardcodedBrandDomains = Object.entries(BRAND_DOMAINS).flatMap(([brand, domains]) =>
      domains.map((domain) => ({
        brand,
        domain: domain.toLowerCase(),
        source: "hardcoded"
      }))
    );

    await upsertBrandDomains(hardcodedBrandDomains);

    const trancoBrandDomains = parsedDomains
      .map((entry) => {
        const brand = findBrandBySld(extractSLD(entry.domain));
        if (!brand) {
          return null;
        }

        return {
          brand,
          domain: entry.domain,
          source: "tranco"
        };
      })
      .filter(
        (
          entry
        ): entry is {
          brand: string;
          domain: string;
          source: string;
        } => Boolean(entry)
      );

    if (trancoBrandDomains.length > 0) {
      await upsertBrandDomains(trancoBrandDomains);
    }

    for (const chunk of chunkArray(parsedDomains, UPSERT_CHUNK_SIZE)) {
      const domains = chunk.map((entry) => entry.domain);
      const existing = await prisma.domainVerificationCache.findMany({
        where: {
          domain: {
            in: domains
          }
        },
        select: {
          domain: true,
          trancoRank: true
        }
      });
      const existingMap = new Map(
        existing.map((entry) => [entry.domain, entry.trancoRank] as const)
      );
      const createData = chunk
        .filter((entry) => !existingMap.has(entry.domain))
        .map((entry) => ({
          domain: entry.domain,
          trancoRank: entry.rank,
          cachedAt: now
        }));

      if (createData.length > 0) {
        await prisma.domainVerificationCache.createMany({
          data: createData
        });
      }

      const updateOperations = chunk
        .filter((entry) => existingMap.has(entry.domain) && existingMap.get(entry.domain) == null)
        .map((entry) =>
          prisma.domainVerificationCache.update({
            where: { domain: entry.domain },
            data: {
              trancoRank: entry.rank,
              cachedAt: now
            }
          })
        );

      if (updateOperations.length > 0) {
        await prisma.$transaction(updateOperations);
      }
    }

    await prisma.trancoSync.create({
      data: {
        syncedAt: now,
        domainCount: parsedDomains.length
      }
    });

    return NextResponse.json({
      synced: parsedDomains.length,
      timestamp: now.toISOString(),
      brandsUpdated: hardcodedBrandDomains.length + trancoBrandDomains.length
    });
  } catch (error) {
    console.error("Tranco sync failed:", error);
    return NextResponse.json(
      { error: "Unable to sync the Tranco list." },
      { status: 503 }
    );
  } finally {
    releaseLock();
  }
}
