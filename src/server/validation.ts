// Request body validation (zod).
// Each schema checks the type and format of the fields a route reads. Unknown extra fields are
// allowed through (routes still pick only their allow-listed columns), so existing screens keep
// working; malformed values are rejected with 400 and a list of the offending fields.
import { z } from 'zod';

type Middleware = (req: any, res: any, next: any) => void;

export function validate(schema: z.ZodTypeAny): Middleware {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      return res.status(400).json({
        error: 'Invalid request',
        fields: result.error.issues.map(i => ({ field: i.path.join('.') || '(body)', message: i.message }))
      });
    }
    req.body = result.data;
    next();
  };
}

// --- building blocks --------------------------------------------------------
const trimmed = (max: number) => z.string().trim().max(max);
const email = z.string().trim().toLowerCase().max(254).regex(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'must be a valid email');
const password = z.string().min(8, 'must be at least 8 characters').max(200);
const id = z.string().trim().min(1).max(100);
// Dates are stored as ISO-8601 text; only that format is accepted (keeps text comparisons correct).
// Empty string / null clears the value.
const isoDate = z.union([
  z.string().trim().regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?)?$/, 'must be a date (YYYY-MM-DD)'),
  z.literal(''),
  z.null()
]);
const optionalText = (max = 255) => z.union([trimmed(max), z.null()]).optional();
const role = z.enum(['power_admin', 'admin', 'approver', 'applier', 'requester', 'viewer']);

// --- auth -------------------------------------------------------------------
export const schemas = {
  login: z.object({ email, password: z.string().min(1).max(200) }).passthrough(),
  register: z.object({ email, password, displayName: trimmed(100).min(1, 'is required') }).passthrough(),
  forgotPassword: z.object({ email }).passthrough(),
  resetPassword: z.object({ email, token: trimmed(100).min(1), newPassword: password }).passthrough(),

  // --- users ------------------------------------------------------------------
  userCreate: z.object({
    email,
    password,
    displayName: trimmed(100).min(1, 'is required'),
    role: role.optional(),
    department: optionalText(), division: optionalText(), project: optionalText(),
    jobTitle: optionalText(), phone: optionalText(50), organizationId: optionalText(100)
  }).passthrough(),
  userUpdate: z.object({
    displayName: trimmed(100).min(1).optional(),
    photoURL: z.union([trimmed(1000), z.null()]).optional(),
    phone: optionalText(50),
    preferences: z.union([z.record(z.any()), z.string().max(20000)]).optional(),
    role: role.optional(),
    status: z.enum(['pending', 'active', 'inactive', 'suspended']).optional(),
    jobTitle: optionalText(), department: optionalText(), division: optionalText(), project: optionalText(),
    email: email.optional(),
    password: password.optional(),
    currentPassword: z.string().max(200).optional(),
    organizationId: optionalText(100)
  }).passthrough(),

  // --- employees ----------------------------------------------------------------
  employee: z.object({
    firstName: optionalText(), lastName: optionalText(), name: optionalText(),
    employeeId: optionalText(100),
    email: z.union([email, z.literal(''), z.null()]).optional(),
    phone: optionalText(50),
    status: z.enum(['active', 'inactive']).optional(),
    passportNumber: optionalText(50), qidVisaNumber: optionalText(50), visaNumber: optionalText(50),
    passportExpiry: isoDate.optional(), visaExpiry: isoDate.optional(), qidVisaExpiry: isoDate.optional(),
    safetyInductionDate: isoDate.optional(), birthDate: isoDate.optional()
  }).passthrough(),

  // --- locations / categories ------------------------------------------------------
  location: z.object({
    name: trimmed(255).min(1, 'is required').optional(),
    code: optionalText(50),
    description: optionalText(2000),
    categoryId: optionalText(100)
  }).passthrough(),
  category: z.object({ name: trimmed(255).min(1, 'is required').optional() }).passthrough(),

  // --- passes -------------------------------------------------------------------------
  pass: z.object({
    employeeId: id.optional(),
    locationId: id.optional(),
    type: z.enum(['main', 'supplementary']).optional(),
    status: trimmed(50).optional(),
    expiryDate: isoDate.optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    remarks: optionalText(1000)
  }).passthrough()
};

// Creation routes require the identifying fields.
export const createSchemas = {
  location: schemas.location.extend({ name: trimmed(255).min(1, 'is required') }),
  category: schemas.category.extend({ name: trimmed(255).min(1, 'is required') }),
  pass: schemas.pass.extend({ employeeId: id, locationId: id })
};
