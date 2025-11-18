using Microsoft.AspNetCore.Mvc;
using System.Diagnostics;

namespace Yolocam.Api.Controllers
{
    [ApiController]
    [Route("system")]
    public class SystemController : ControllerBase
    {
        [HttpGet]
        public IActionResult GetSystemInfo()
        {
            var result = new
            {
                cpu = "N/A",
                ram = new { used = 0.0, total = 0.0 },
                gpu = new { name = "N/A", usage = (int?)null },
                model = "VALID_ONLY"
            };

            return Ok(result);
        }
    }
}
