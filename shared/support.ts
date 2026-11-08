import { z } from "zod";

export const SUPPORT_STATUSES = [
  "pending",
  "processing",
  "waiting_customer",
  "needs_owner",
  "resolved",
  "ignored",
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const SUPPORT_LABELS: Record<SupportStatus, string> = {
  pending: "等待巡检",
  processing: "自动处理中",
  waiting_customer: "等客户补充",
  needs_owner: "待你决定",
  resolved: "已解决",
  ignored: "无需处理",
};
export interface SupportCase {
  id: string;
  mailboxId: string;
  threadId: string;
  subject: string;
  sender: string;
  latestEmailId: string;
  latestInboundAt: string;
  createdAt: string;
  updatedAt: string;
  status: SupportStatus;
  summary: string;
  nextAction: string;
  version: number;
  claimId?: string;
  replyOperationId?: string;
  ownerInstructionPending?: boolean;
  delivery?: "accepted" | "uncertain" | "failed";
  origin?: "inbound" | "outbound";
  waitingSince?: string;
}
export interface SupportEvent {
  id: string;
  caseId: string | null;
  createdAt: string;
  actor: "system" | "agent" | "operator";
  kind: string;
  summary: string;
  evidence?: string;
  replyText?: string;
  providerMessageId?: string;
}
export interface SupportAutomation {
  enabled: boolean;
  intervalMinutes: number;
  schedulerId?: string;
  lastScanAt?: string;
  lastRunStartedAt?: string;
  lastRunFinishedAt?: string;
  lastError?: string;
  lastScanError?: string;
  runningUntil?: string;
  runId?: string;
}
export interface SupportDashboard {
  cases: SupportCase[];
  counts: Record<SupportStatus, number>;
  total: number;
  page: number;
  totalPages: number;
  automation: SupportAutomation;
  recentEvents: SupportEvent[];
}
export interface SupportActivity extends SupportEvent {
  caseSubject?: string;
  mailboxId?: string;
  caseStatus?: SupportStatus;
}
export interface SupportActivityPage {
  events: SupportActivity[];
  total: number;
  page: number;
  totalPages: number;
}
export interface SupportOverview {
  counts: Record<SupportStatus, number>;
  ownerCases: SupportCase[];
  workingCases: SupportCase[];
  waitingCount: number;
  followUpCount: number;
  todayTouched: number;
  todayResolved: number;
  todayEvents: SupportActivity[];
  automation: SupportAutomation;
}
export const SupportComposeSchema = z.object({
  operationId: z.string().min(8).max(180),
  mailboxId: z
    .string()
    .email()
    .transform((value) => value.toLowerCase()),
  to: z
    .string()
    .email()
    .transform((value) => value.toLowerCase()),
  subject: z.string().trim().min(1).max(300),
  text: z.string().trim().min(1).max(15000),
});
export type SupportCompose = z.infer<typeof SupportComposeSchema>;

export const SupportUpdateSchema = z.object({
  operationId: z.string().min(8).max(180),
  expectedVersion: z.number().int().positive(),
  status: z.enum(SUPPORT_STATUSES),
  summary: z.string().trim().min(1).max(3000),
  nextAction: z.string().max(3000).default(""),
  evidence: z.string().max(6000).optional(),
});
export const SupportReplySchema = z.object({
  operationId: z.string().min(8).max(180),
  expectedVersion: z.number().int().positive(),
  claimId: z.string().min(8).max(180),
  text: z.string().trim().min(1).max(15000),
  summary: z.string().trim().min(1).max(3000),
  status: z.enum(["waiting_customer", "resolved"]).default("waiting_customer"),
});
export type SupportUpdate = z.infer<typeof SupportUpdateSchema>;
export type SupportReply = z.infer<typeof SupportReplySchema>;
