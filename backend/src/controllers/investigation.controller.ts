import type { Request, Response } from "express";
import { z } from "zod";
import type { InputType } from "@prisma/client";
import {
  createAndRunInvestigation,
  getInvestigationById,
  listInvestigations,
  deleteInvestigation,
  deleteAllInvestigations,
  purgeExpiredInvestigations,
} from "../services/investigation.service";
import { ApiError } from "../middleware/errorHandler";
import { recordAudit } from "../middleware/audit";
import { investigationToCsv, investigationToJson, historyToCsv } from "../lib/exporters";
import { buildReport, renderMarkdown } from "../lib/report";

const INPUT_TYPES = ["EMAIL", "PHONE", "USERNAME", "DOMAIN", "IP"] as const;

const createSchema = z.object({
  type: z.enum(INPUT_TYPES),
  value: z.string().min(1).max(500),
});

const listQuerySchema = z.object({
  type: z.enum(INPUT_TYPES).optional(),
  status: z.enum(["PENDING", "RUNNING", "COMPLETED", "PARTIAL", "FAILED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function handleCreate(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const body = createSchema.parse(req.body);

  const { id, status } = await createAndRunInvestigation(req.user.id, body.type as InputType, body.value);
  await recordAudit({ userId: req.user.id, investigationId: id, action: "investigation.created", details: { type: body.type, input: body.value }, req });

  res.status(202).json({ id, status });
}

export async function handleGet(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const isAdmin = req.user.role === "ADMIN";
  const row = await getInvestigationById(req.params.id, req.user.id, isAdmin);
  if (!row) throw new ApiError(404, "Investigation not found");
  res.json(row);
}

export async function handleList(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const query = listQuerySchema.parse(req.query);
  const isAdmin = req.user.role === "ADMIN";
  const result = await listInvestigations({
    userId: req.user.id,
    isAdmin,
    inputType: query.type as InputType | undefined,
    status: query.status,
    limit: query.limit,
    offset: query.offset,
  });
  res.json(result);
}

export async function handleDelete(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const isAdmin = req.user.role === "ADMIN";
  const deleted = await deleteInvestigation(req.params.id, req.user.id, isAdmin);
  if (!deleted) throw new ApiError(404, "Investigation not found");
  await recordAudit({ userId: req.user.id, action: "investigation.deleted", details: { id: req.params.id }, req });
  res.status(204).send();
}

export async function handleDeleteAll(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const count = await deleteAllInvestigations(req.user.id);
  await recordAudit({ userId: req.user.id, action: "investigation.delete_all", details: { count }, req });
  res.json({ deleted: count });
}

export async function handleExport(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const isAdmin = req.user.role === "ADMIN";
  const row = await getInvestigationById(req.params.id, req.user.id, isAdmin);
  if (!row) throw new ApiError(404, "Investigation not found");

  const format = req.query.format === "csv" ? "csv" : "json";
  const content = format === "csv" ? investigationToCsv(row) : investigationToJson(row);

  res.setHeader("Content-Type", format === "csv" ? "text/csv; charset=utf-8" : "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sentinel-${row.id}.${format}"`);
  res.send(content);
}

export async function handleExportHistory(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const { items } = await listInvestigations({
    userId: req.user.id,
    isAdmin: req.user.role === "ADMIN",
    limit: 100,
  });
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="sentinel-history.csv"`);
  res.send(historyToCsv(items));
}

export async function handleReport(req: Request, res: Response): Promise<void> {
  if (!req.user) throw new ApiError(401, "Authentication required");
  const isAdmin = req.user.role === "ADMIN";
  const row = await getInvestigationById(req.params.id, req.user.id, isAdmin);
  if (!row) throw new ApiError(404, "Investigation not found");

  const report = buildReport(row);
  if (req.query.format === "markdown") {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.send(renderMarkdown(report));
    return;
  }
  res.json({ report });
}

export async function handlePurge(req: Request, res: Response): Promise<void> {
  if (req.user?.role !== "ADMIN") throw new ApiError(403, "Insufficient permissions");
  const count = await purgeExpiredInvestigations();
  await recordAudit({ userId: req.user.id, action: "investigation.purge_expired", details: { count }, req });
  res.json({ purged: count });
}
