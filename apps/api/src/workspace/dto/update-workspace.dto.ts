import { IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { Transform } from "class-transformer";

/**
 * PATCH /workspace — what a workspace can change about itself today. The subdomain is
 * absent on purpose: it is half of everyone's sign-in, so renaming it is a migration,
 * not a settings field.
 */
export class UpdateWorkspaceDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  /** Blank clears it — the column is nullable, and "no industry" is a real answer. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  @Transform(({ value }) => (typeof value === "string" && value.trim() === "" ? null : value))
  industryVertical?: string | null;
}
