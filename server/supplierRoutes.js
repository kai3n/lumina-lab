import { Router } from "express";
import { ApiError } from "./errors.js";
import { rateLimit } from "./rateLimit.js";
import { revokeSession } from "./session.js";
import {
  COOKIE_SUPPLIER,
  clearSessionCookie,
  requireAdmin,
  requireFullAdmin,
  requireSupplier,
  setSessionCookie,
} from "./middleware.js";
import { sendVendorInvite, sendVendorPasswordReset } from "./mailer.js";
import { sendOrderEventMail } from "./orderMail.js";
import { sendPushToStaff } from "./push.js";
import {
  acceptSupplierInvite,
  addSupplierUpdate,
  assignSupplierOrder,
  completeSupplierJob,
  completeSupplierMediaUpload,
  createSupplier,
  createSupplierInvite,
  createSupplierMediaUpload,
  createSupplierPasswordReset,
  getSupplierById,
  getSupplierOrder,
  listSupplierInventory,
  listSupplierOrders,
  listSuppliers,
  loginSupplier,
  reviewSupplierUpdate,
  resetSupplierPassword,
  saveSupplierInventory,
  transitionSupplierJobByAdmin,
  transitionSupplierWorkflow,
  updateSupplierStatus,
} from "./supplierRepository.js";

const MINUTE = 60 * 1000;
const VENDOR_VIDEO_MAX_BYTES = 200 * 1024 * 1024;
const VENDOR_UPLOAD_TTL_SECONDS = 30 * 60;

function vendorOrigin(req) {
  return process.env.VENDOR_ORIGIN || process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get("host")}`;
}

function vendorAppUrl(req) {
  const url = process.env.VENDOR_APP_URL
    ? new URL(process.env.VENDOR_APP_URL)
    : new URL("/vendor/", `${vendorOrigin(req).replace(/\/$/, "")}/`);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new ApiError("INTERNAL_ERROR", 500);
  return url;
}

function vendorAuthUrl(req, parameter, token) {
  const url = vendorAppUrl(req);
  url.searchParams.set(parameter, token);
  return url.toString();
}

function notifyCustomer(notify) {
  if (!notify?.email) return;
  void sendOrderEventMail(notify).catch((error) => {
    console.error("[supplier-order-event] email delivery failed", error);
  });
}

export function supplierRouter() {
  const r = Router();

  r.post("/auth/accept-invite",
    rateLimit({ limit: 10, windowMs: MINUTE }),
    async (req, res, next) => {
      try {
        const { token, password } = req.body || {};
        const result = await acceptSupplierInvite(token, password);
        setSessionCookie(res, COOKIE_SUPPLIER, result.session);
        res.json({ ok: true, supplier: result.supplier });
      } catch (e) { next(e); }
    });

  r.post("/auth/password",
    rateLimit({ limit: 5, windowMs: MINUTE, keyFn: (req) => `${req.ip}:${String(req.body?.email || "").toLowerCase()}` }),
    async (req, res, next) => {
      try {
        const { email, password } = req.body || {};
        if (typeof email !== "string" || typeof password !== "string") throw new ApiError("VALIDATION_ERROR", 400);
        const result = await loginSupplier(email, password);
        setSessionCookie(res, COOKIE_SUPPLIER, result.session);
        res.json({ ok: true, supplier: result.supplier });
      } catch (e) { next(e); }
    });

  r.post("/auth/password-reset/request",
    rateLimit({ limit: 20, windowMs: MINUTE }),
    rateLimit({ limit: 3, windowMs: MINUTE, keyFn: (req) => `${req.ip}:${String(req.body?.email || "").toLowerCase()}` }),
    async (req, res, next) => {
      try {
        const { email } = req.body || {};
        if (typeof email !== "string") throw new ApiError("VALIDATION_ERROR", 400);
        const reset = await createSupplierPasswordReset(email);
        if (reset) {
          const link = vendorAuthUrl(req, "reset", reset.token);
          await sendVendorPasswordReset(reset.supplier.email, link, reset.supplier.locale)
            .catch((error) => console.error("[supplier-password-reset] email delivery failed", error));
        }
        res.status(202).json({ ok: true });
      } catch (e) { next(e); }
    });

  r.post("/auth/password-reset/confirm",
    rateLimit({ limit: 10, windowMs: MINUTE }),
    async (req, res, next) => {
      try {
        const { token, password } = req.body || {};
        const result = await resetSupplierPassword(token, password);
        setSessionCookie(res, COOKIE_SUPPLIER, result.session);
        res.json({ ok: true, supplier: result.supplier });
      } catch (e) { next(e); }
    });

  r.post("/auth/logout", async (req, res, next) => {
    try {
      await revokeSession(req.cookies?.[COOKIE_SUPPLIER]);
      clearSessionCookie(res, COOKIE_SUPPLIER);
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

  r.get("/me", requireSupplier, async (req, res, next) => {
    try {
      res.json({ ok: true, supplier: await getSupplierById(req.principal.supplierId) });
    } catch (e) { next(e); }
  });

  r.get("/orders",
    rateLimit({ limit: 120, windowMs: MINUTE }),
    requireSupplier,
    async (req, res, next) => {
      try {
        res.json({ ok: true, orders: await listSupplierOrders(req.principal.supplierId) });
      } catch (e) { next(e); }
    });

  r.get("/orders/:jobCode", requireSupplier, async (req, res, next) => {
    try {
      res.json({ ok: true, order: await getSupplierOrder(req.principal.supplierId, req.params.jobCode) });
    } catch (e) { next(e); }
  });

  r.post("/orders/:jobCode/updates",
    rateLimit({ limit: 60, windowMs: MINUTE }),
    requireSupplier,
    async (req, res, next) => {
      try {
        const update = await addSupplierUpdate(req.principal.supplierId, req.params.jobCode, req.body || {});
        res.status(201).json({ ok: true, update });
        sendPushToStaff({
          title: `Vendor submission · ${req.params.jobCode}`,
          body: `${update.type}${update.note ? ` · ${update.note.slice(0, 100)}` : ""}`,
          code: req.params.jobCode,
        }).catch(() => {});
      } catch (e) { next(e); }
    });

  r.post("/orders/:jobCode/stage",
    rateLimit({ limit: 30, windowMs: MINUTE }),
    requireSupplier,
    async (req, res, next) => {
      try {
        const transition = await transitionSupplierWorkflow(
          req.principal.supplierId,
          req.params.jobCode,
          req.body?.type || req.body?.action,
        );
        const { notify, ...publicTransition } = transition;
        res.status(201).json({ ok: true, transition: publicTransition });
        notifyCustomer(notify);
      } catch (e) { next(e); }
    });

  r.post("/orders/:jobCode/media/upload-url",
    rateLimit({ limit: 30, windowMs: MINUTE }),
    requireSupplier,
    async (req, res, next) => {
      try {
        const signed = await createSupplierMediaUpload(
          req.principal.supplierId,
          req.params.jobCode,
          req.body || {},
          {
          origin: vendorOrigin(req),
          provider: process.env.VENDOR_MEDIA_PROVIDER || "cos",
          videoMaxBytes: VENDOR_VIDEO_MAX_BYTES,
            expiresIn: VENDOR_UPLOAD_TTL_SECONDS,
          },
        );
        res.status(201).json({ ok: true, ...signed });
      } catch (e) { next(e); }
    });

  r.post("/orders/:jobCode/media/:mediaCode/complete",
    rateLimit({ limit: 60, windowMs: MINUTE }),
    requireSupplier,
    async (req, res, next) => {
      try {
        const media = await completeSupplierMediaUpload(
          req.principal.supplierId,
          req.params.jobCode,
          req.params.mediaCode,
        );
        res.json({ ok: true, media });
      } catch (e) { next(e); }
    });

  r.get("/inventory", requireSupplier, async (req, res, next) => {
    try {
      res.json({ ok: true, inventory: await listSupplierInventory(req.principal.supplierId) });
    } catch (e) { next(e); }
  });

  r.post("/inventory", requireSupplier, async (req, res, next) => {
    try {
      const stone = await saveSupplierInventory(req.principal.supplierId, req.body || {});
      res.status(201).json({ ok: true, stone });
    } catch (e) { next(e); }
  });

  r.patch("/inventory/:inventoryId", requireSupplier, async (req, res, next) => {
    try {
      const stone = await saveSupplierInventory(req.principal.supplierId, req.body || {}, req.params.inventoryId);
      res.json({ ok: true, stone });
    } catch (e) { next(e); }
  });

  return r;
}

export function supplierAdminRouter() {
  const r = Router();

  r.get("/suppliers", requireAdmin, async (_req, res, next) => {
    try {
      res.json({ ok: true, suppliers: await listSuppliers() });
    } catch (e) { next(e); }
  });

  r.post("/suppliers", requireFullAdmin, async (req, res, next) => {
    try {
      const supplier = await createSupplier(req.body || {}, req.principal.id);
      res.status(201).json({ ok: true, supplier });
    } catch (e) { next(e); }
  });

  r.patch("/suppliers/:supplierCode", requireFullAdmin, async (req, res, next) => {
    try {
      const supplier = await updateSupplierStatus(req.params.supplierCode, req.body?.status, req.principal.id);
      res.json({ ok: true, supplier });
    } catch (e) { next(e); }
  });

  r.post("/suppliers/:supplierCode/invites", requireFullAdmin, async (req, res, next) => {
    try {
      const invite = await createSupplierInvite(req.params.supplierCode, req.principal.id);
      const inviteUrl = vendorAuthUrl(req, "token", invite.token);
      let emailSent = true;
      try {
        await sendVendorInvite(invite.supplier.email, inviteUrl, invite.supplier.locale);
      } catch (error) {
        emailSent = false;
        console.error("[supplier-invite] email delivery failed", error);
      }
      res.status(201).json({
        ok: true,
        supplier: invite.supplier,
        expiresAt: invite.expiresAt,
        inviteUrl,
        emailSent,
      });
    } catch (e) { next(e); }
  });

  r.post("/orders/:orderCode/supplier", requireFullAdmin, async (req, res, next) => {
    try {
      const assignment = await assignSupplierOrder({
        orderCode: req.params.orderCode,
        supplierCode: req.body?.supplierCode,
        dueAt: req.body?.dueAt,
      }, req.principal.id);
      res.status(201).json({ ok: true, assignment });
    } catch (e) { next(e); }
  });

  r.patch("/supplier-updates/:updateId/review", requireFullAdmin, async (req, res, next) => {
    try {
      const update = await reviewSupplierUpdate(
        req.params.updateId,
        req.body?.status,
        req.body?.reviewNote,
        req.principal.id,
      );
      const { notify, ...publicUpdate } = update;
      res.json({ ok: true, update: publicUpdate });
      notifyCustomer(notify);
    } catch (e) { next(e); }
  });

  r.post("/supplier-jobs/:jobCode/transition", requireFullAdmin, async (req, res, next) => {
    try {
      const job = await transitionSupplierJobByAdmin(
        req.params.jobCode,
        req.body?.action,
        req.body || {},
        req.principal.id,
      );
      res.json({ ok: true, job });
    } catch (e) { next(e); }
  });

  r.post("/supplier-jobs/:jobCode/complete", requireFullAdmin, async (req, res, next) => {
    try {
      res.json({ ok: true, job: await completeSupplierJob(req.params.jobCode, req.principal.id) });
    } catch (e) { next(e); }
  });

  return r;
}
