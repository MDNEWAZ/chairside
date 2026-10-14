namespace DentalStaff.Domain.Entities;

public static class Roles
{
    public const string OwnerAdmin = "owner_admin";
    public const string PracticeManager = "practice_manager";
    public const string ClinicalStaff = "clinical_staff";
    public const string Reception = "reception";

    public static readonly IReadOnlyList<string> All = [OwnerAdmin, PracticeManager, ClinicalStaff, Reception];

    public static bool IsManager(string role) => role is OwnerAdmin or PracticeManager;
}

public static class LeaveTypes
{
    public const string Annual = "annual";
    public const string Sick = "sick";
    public const string Other = "other";

    public static readonly IReadOnlyList<string> All = [Annual, Sick, Other];
}

public static class LeaveStatuses
{
    public const string Pending = "pending";
    public const string Approved = "approved";
    public const string Rejected = "rejected";
}

public static class Plans
{
    public const string Trial = "trial";
    public const string Starter = "starter";
    public const string Practice = "practice";

    /// <summary>Location limit per plan. Billing is simulated in the prototype; the limit is enforced for real.</summary>
    public static int MaxLocations(string plan) => plan == Starter ? 1 : 3;

    public static bool IsKnown(string plan) => plan is Trial or Starter or Practice;
}
