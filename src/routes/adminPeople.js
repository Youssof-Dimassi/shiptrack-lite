// Staff-only: users, the activity log, and the dashboard.
//
//   GET    /api/admin/dashboard                     → numbers and lists for the dashboard
//   GET    /api/admin/activity?page=&category=      → the activity log, newest first
//   GET    /api/admin/users?page=&search=           → users
//   PUT    /api/admin/users/:userId/role { role }   → make someone staff, or remove it
//   DELETE /api/admin/users/:userId                 → delete a customer's account

import { Router } from "express";
import { requireAdmin, requireAuth } from "../auth/middleware.js";
import { runInTransaction } from "../db/database.js";
import { ACTIVITY_CATEGORIES, listActivity, logActivity } from "../models/activityLog.js";
import { getDashboardData } from "../models/dashboard.js";
import { deleteUser, findUserById, listUsers, setUserRoleById } from "../models/users.js";

export const adminPeopleRouter = Router();

const ROLES = ["customer", "admin"];

adminPeopleRouter.use(requireAuth, requireAdmin);

adminPeopleRouter.get("/dashboard", (req, res) => {
  res.json(getDashboardData());
});

adminPeopleRouter.get("/activity", (req, res) => {
  const page = readPage(req.query.page);
  const category = req.query.category ?? null;
  if (!page) return badRequest(res, "Invalid page number.");
  if (category !== null && !ACTIVITY_CATEGORIES.includes(category)) return badRequest(res, "Invalid category.");

  res.json(listActivity({ page, category }));
});

adminPeopleRouter.get("/users", (req, res) => {
  const page = readPage(req.query.page);
  const search = req.query.search ?? "";
  if (!page) return badRequest(res, "Invalid page number.");
  if (typeof search !== "string" || search.length > 100) return badRequest(res, "Search text can be up to 100 characters.");

  res.json({ ...listUsers({ page, pageSize: 20, search: search.trim() }), currentUserId: req.user.id });
});

adminPeopleRouter.put("/users/:userId/role", (req, res) => {
  const userId = readId(req.params.userId);
  const role = req.body?.role;
  if (!userId) return badRequest(res, "Invalid user.");
  if (!ROLES.includes(role)) return badRequest(res, "Role must be customer or admin.");

  // Changing your own role could lock everyone out of the admin area.
  if (userId === req.user.id) return res.status(409).json({ error: "You can't change your own role." });

  const user = findUserById(userId);
  if (!user) return res.status(404).json({ error: "That user doesn't exist." });

  if (user.role !== role) {
    runInTransaction(() => {
      setUserRoleById(userId, role);
      logActivity(
        req.user,
        "user.role_changed",
        role === "admin" ? `Made ${user.email} an admin` : `Removed admin access from ${user.email}`,
      );
    });
  }

  res.json({ user: findUserById(userId) });
});

adminPeopleRouter.delete("/users/:userId", (req, res) => {
  const userId = readId(req.params.userId);
  if (!userId) return badRequest(res, "Invalid user.");
  if (userId === req.user.id) {
    return res.status(409).json({ error: "Use Account settings to delete your own account." });
  }

  const user = findUserById(userId);
  if (!user) return res.status(404).json({ error: "That user doesn't exist." });

  // Two steps for staff accounts: remove admin access first, then delete.
  if (user.role === "admin") return res.status(409).json({ error: "Remove their admin access before deleting the account." });

  runInTransaction(() => {
    deleteUser(userId);
    logActivity(req.user, "user.deleted", `Deleted the account of ${user.email}`);
  });

  res.status(204).end();
});

// --- Helpers ----------------------------------------------------------------

function badRequest(res, error) {
  return res.status(400).json({ error });
}

function readPage(value = "1") {
  return typeof value === "string" && /^[1-9]\d{0,8}$/.test(value) ? Number(value) : null;
}

function readId(value) {
  return /^[1-9]\d{0,11}$/.test(value) ? Number(value) : null;
}
