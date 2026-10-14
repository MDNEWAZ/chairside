using DentalStaff.Application.Common;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace DentalStaff.Api.Infrastructure;

/// <summary>Maps expected application errors to ProblemDetails. Unexpected errors never leak details.</summary>
public sealed class AppExceptionHandler(IProblemDetailsService problemDetails, ILogger<AppExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken cancellationToken)
    {
        ProblemDetails problem = exception switch
        {
            ValidationException v => new ValidationProblemDetails(v.Errors) { Status = 400, Title = v.Message },
            NotFoundException e => new ProblemDetails { Status = 404, Title = e.Message },
            ForbiddenException e => new ProblemDetails { Status = 403, Title = e.Message },
            ConflictException e => new ProblemDetails { Status = 409, Title = e.Message },
            UnauthorizedAccessException => new ProblemDetails { Status = 401, Title = "Please sign in again." },
            _ => new ProblemDetails { Status = 500, Title = "Something went wrong on our side. Try again in a moment." },
        };
        if (problem.Status == 500) logger.LogError(exception, "Unhandled error");

        context.Response.StatusCode = problem.Status!.Value;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext { HttpContext = context, ProblemDetails = problem, Exception = exception });
    }
}

public static class ModelBindingErrors
{
    /// <summary>
    /// Turns ASP.NET model-binding failures (for example an empty date) into the same field-keyed shape as
    /// our own validation, with plain messages. The default response names internal .NET types.
    /// </summary>
    public static IActionResult ToProblem(ActionContext context)
    {
        var parameterNames = context.ActionDescriptor.Parameters.Select(p => p.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var errors = new Dictionary<string, string[]>();
        foreach (var (key, entry) in context.ModelState)
        {
            if (entry.Errors.Count == 0) continue;
            var field = key.StartsWith("$.", StringComparison.Ordinal) ? key[2..] : key;
            if (field.Length == 0 || field == "$" || parameterNames.Contains(field)) continue;
            field = char.ToLowerInvariant(field[0]) + field[1..];
            errors[field] = [MessageFor(field)];
        }

        var problem = errors.Count > 0
            ? new ValidationProblemDetails(errors) { Status = 400, Title = "Some fields need attention." }
            : new ProblemDetails { Status = 400, Title = "The request could not be read. Reload the page and try again." };
        return new ObjectResult(problem) { StatusCode = 400, ContentTypes = { "application/problem+json" } };
    }

    private static string MessageFor(string field) =>
        field.EndsWith("Date", StringComparison.OrdinalIgnoreCase) || field.EndsWith("On", StringComparison.Ordinal)
            ? "Enter a valid date."
            : field.EndsWith("Time", StringComparison.OrdinalIgnoreCase)
                ? "Enter a valid time."
                : "Enter a valid value.";
}

public static class SecurityMiddleware
{
    public const string CsrfHeader = "X-Chairside-Csrf";

    /// <summary>
    /// CSRF defence in depth on top of SameSite=Strict cookies: every state-changing request must carry a
    /// custom header. Browsers cannot add it cross-site without a CORS preflight, which this API never allows.
    /// </summary>
    public static IApplicationBuilder UseCsrfHeaderCheck(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        if (!HttpMethods.IsGet(ctx.Request.Method) && !HttpMethods.IsHead(ctx.Request.Method) && !HttpMethods.IsOptions(ctx.Request.Method)
            && ctx.Request.Path.StartsWithSegments("/api") && !ctx.Request.Headers.ContainsKey(CsrfHeader))
        {
            ctx.Response.StatusCode = 400;
            await ctx.Response.WriteAsJsonAsync(new ProblemDetails { Status = 400, Title = "Missing request header. Reload the page and try again." });
            return;
        }
        await next();
    });

    public static IApplicationBuilder UseSecurityHeaders(this IApplicationBuilder app) => app.Use(async (ctx, next) =>
    {
        ctx.Response.Headers.XContentTypeOptions = "nosniff";
        ctx.Response.Headers["Referrer-Policy"] = "no-referrer";
        ctx.Response.Headers.XFrameOptions = "DENY";
        ctx.Response.Headers.CacheControl = "no-store";
        await next();
    });
}
