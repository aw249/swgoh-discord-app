/** Base64-encoded stat icons used in HTML image generation. */
export const SPEED_ICON =
  'data:image/webp;base64,UklGRh4CAABXRUJQVlA4TBICAAAvH8AHEJVAbCRJkbT+Ox0PvbP3YEA9Qx1ESAIAsIykrm3b9v5s27Zt27Zt27Zt28b51pmAvKIQYCJCg50EY77S1Bhz7EIRuiW4BBhxE6dU49W2O/+AfbOIVuARYcFPsjpDFmx66irnlREsVFT40WKlwJqf+UnuoUS4R2XkESTUJ/4JauhLUPG5bmtPOlmU2h85whTsTrVRSKDhpMJGgFwNuo04AUYfRhW59uxAB8FEKVBRCVQcVNnwl6/H7Gfrtx1fbevTf5cysSVEvQIOUWcXDDRVrTAoVBV7bVvf3jxopKa3/c8iOvt1hiC5+vVo1znGFcg4uFFMoqqjj0FyDoJDiYv92+CFDnPD/gGese1Ax0ntIluzaadefXRWvkEBh0ec8OzCJcFeiHK9Zm0492vyh8gGnRQ2CjzaJrX/p0lQuR38J7BBJwQLDSEa7KqAUV0OwiXKkp9sNQZsuPMfGL3gO0SSMR+Fuiw68OB70r1Bx/+RJTARUfE4XZViOYLBg5+ScSQifQP1y7+29cgT7pocoPVbLhNHrXfWNC32sQkKSxeV/re9tVUNcYOQ8HLVtl7V4F0IRGbOb0DbT3QblASLQp9AW7eCYO4lZ0b6HAFlskEzKQNe29YS5YUkCAWIzSK9M9BWzFoClTC1Pw48RMhSol6jcmtAawXuGhjoqAnSZMqBtzDp6nQbsWI19lzR3qBXEQ==';

export const HEALTH_ICON =
  'data:image/webp;base64,UklGRswAAABXRUJQVlA4TMAAAAAvH8AHEIXjRpIUqfx3Opau4egdATXbtmXZg7tFG8CzL8BBsi8yxHuQiFQGcKju0ojMQHJ3T/x6T0Doi1rBs9Q/QEhHR0dHucEHAGDwzcRr7i/9Ffj9gpOZmcILaEsxe4IuWajYUzIBBYLQhn+QCNV74G1YHCq/h1pV0y+Au3OrLAkA8nA3Co2KAgDGscDpA4CFFpjsAbDQFJmsrKwxABYao4E7FlqyCr2T3JKJYKhLhMPhcAIvPMSIQ5tsivShrwo=';

export const PROTECTION_ICON =
  'data:image/webp;base64,UklGRsYAAABXRUJQVlA4TLoAAAAvH8AHEFU4bhvJkTb/pHm2u8++a3Yi3AYAQDbRpguSKaNHfGFfkDMwp1y78gGvbj/gAbYxAfmxBI2T+Aqkkq//mYWaQkjczofZiAmI0Nq/uIWrRTXzb4ZaI+mdg/qkiqn/aCq6M6koz6QimhFXuDOpYGd2BWQ3YQ+qRH1ipyyYWDWoc29Da1HsKaaJ9upkdSLtyBxAG2FVy+6F7FlZlEzSfJ6tnVm6yyMXeqYxJncrBzAPYuobZB/Afwk=';

/**
 * Numeric keys used to look up unit stats from the swgoh.gg stats object.
 * These are the raw stat IDs from the game data.
 */
export const STAT_IDS = {
  HEALTH: '1',
  SPEED: '5',
  PROTECTION: '28',
} as const;
