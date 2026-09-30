import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from "class-validator";
import type { LoginRequest, LogoutRequest, RefreshRequest } from "@appsgain/shared";

/**
 * The `implements` clauses are the point of these classes: class-validator gives the
 * runtime check, @appsgain/shared gives the shape, and implementing the shared interface
 * is what stops the two descriptions of the same request from drifting apart.
 */

export const SUBDOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/;

export class LoginDto implements LoginRequest {
  @IsString()
  @Matches(SUBDOMAIN_PATTERN, {
    message: "subdomain must be lowercase letters, digits and hyphens",
  })
  subdomain!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}

export class RefreshDto implements RefreshRequest {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class LogoutDto implements LogoutRequest {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

/**
 * 12 characters with no composition rules. Length is what resists an offline attack on
 * the Argon2 digest; forcing a symbol mostly produces "Password1!" and a sticky note.
 */
/**
 * Changing a password re-authenticates: the current one is the proof, the new one is the
 * change. Same 12-character floor as everywhere else a password is set.
 */
export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  currentPassword!: string;

  @IsString()
  @MinLength(12, { message: "newPassword must be at least 12 characters" })
  @MaxLength(200)
  newPassword!: string;
}

export class PasswordDto {
  @IsString()
  @MinLength(12, { message: "password must be at least 12 characters" })
  @MaxLength(200)
  password!: string;
}

/** Sign-in step two: the challenge from step one, and a 6-digit code or a backup code. */
export class TwoFactorSignInDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  challengeToken!: string;

  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string;
}

export class ForgotPasswordDto {
  @IsString()
  @Matches(SUBDOMAIN_PATTERN, {
    message: "workspace must be lowercase letters, digits and hyphens",
  })
  subdomain!: string;

  @IsEmail()
  @MaxLength(254)
  email!: string;
}

/**
 * A token from an emailed link, sent in a body rather than a query string so it does not
 * end up in access logs on the way in.
 */
export class TokenDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2048)
  token!: string;
}

export class ResetPasswordDto extends TokenDto {
  @IsString()
  @MinLength(12, { message: "password must be at least 12 characters" })
  @MaxLength(200)
  password!: string;
}

export class VerifyEmailDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: "code must be six digits" })
  code!: string;
}

/** Re-authentication for a security change: the account's current password. */
export class CurrentPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}

export class TwoFactorCodeDto {
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string;
}

export class PasswordAndCodeDto extends CurrentPasswordDto {
  @IsString()
  @MinLength(6)
  @MaxLength(20)
  code!: string;
}

export class AcceptInvitationDto extends TokenDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @IsString()
  @MinLength(12, { message: "password must be at least 12 characters" })
  @MaxLength(200)
  password!: string;
}
