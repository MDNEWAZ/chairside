using System.Net;
using System.Net.Sockets;

namespace DentalStaff.Api.Infrastructure;

/// <summary>
/// The visitor's address for rate limiting. Behind a reverse proxy (the Vercel front end forwards /api here),
/// every request arrives from the proxy, so the first X-Forwarded-For entry is used instead; otherwise all
/// visitors would share one limit. IPv6 addresses are grouped by their /64, since one home or phone gets a whole /64.
/// </summary>
public static class ClientAddress
{
    public static string For(HttpContext ctx, bool behindProxy)
    {
        IPAddress? ip = null;
        if (behindProxy)
        {
            var forwarded = ctx.Request.Headers["X-Forwarded-For"].ToString().Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries);
            if (forwarded.Length > 0) IPAddress.TryParse(forwarded[0], out ip);
            if (ip is null) IPAddress.TryParse(ctx.Request.Headers["X-Real-IP"].ToString(), out ip);
        }
        ip ??= ctx.Connection.RemoteIpAddress;
        if (ip is null) return "unknown";
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        if (ip.AddressFamily != AddressFamily.InterNetworkV6) return ip.ToString();

        var bytes = ip.GetAddressBytes();
        Array.Clear(bytes, 8, 8);
        return new IPAddress(bytes) + "/64";
    }
}
