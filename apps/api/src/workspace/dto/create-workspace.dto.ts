import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";
import { Transform } from "class-transformer";
import type { CreateWorkspaceRequest } from "@appsgain/shared";
import { SUBDOMAIN_PATTERN } from "../../auth/dto/auth.dto";

/**
 * Subdomains that would collide with the platform's own hostnames. Reserving them here
 * rather than discovering the clash in DNS is the cheap end of the problem.
 */
export const RESERVED_SUBDOMAINS = new Set([
  "www",
  "api",
  "app",
  "admin",
  "auth",
  "static",
  "assets",
  "cdn",
  "mail",
  "status",
  "support",
  "docs",
  "appsgain",
]);

export class CreateWorkspaceDto implements CreateWorkspaceRequest {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  @Matches(SUBDOMAIN_PATTERN, {
    message:
      "subdomain must be 3–50 characters of lowercase letters, digits and hyphens, " +
      "and may not start or end with a hyphen",
  })
  subdomain!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  industryVertical?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  ownerName!: string;

  @IsEmail()
  @MaxLength(254)
  @Transform(({ value }) => (typeof value === "string" ? value.trim().toLowerCase() : value))
  ownerEmail!: string;

  @IsString()
  @MinLength(12, { message: "ownerPassword must be at least 12 characters" })
  @MaxLength(200)
  ownerPassword!: string;
}
