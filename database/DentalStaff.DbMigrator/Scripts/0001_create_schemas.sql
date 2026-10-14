-- Schemas separate data by sensitivity so permissions and row-level security can be applied per schema.
--   app   : general clinic data (locations, staff, shifts, leave, attendance, credentials)
--   pay   : pay and compensation only (owner_admin or the person it belongs to)
--   sec   : row-level security predicate functions and policies
--   audit : the audit log, written by triggers
CREATE SCHEMA app;
GO
CREATE SCHEMA pay;
GO
CREATE SCHEMA sec;
GO
CREATE SCHEMA audit;
GO
