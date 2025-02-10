import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Transform } from "class-transformer";
import { IsArray, IsNumber, IsOptional, IsBoolean, IsString } from "class-validator";

export const ARE_DEFAULT_EVENT_TYPES_ENABLED_DOCS =
  "If true, when creating a managed user the managed user will have 4 default event types: 30 and 60 minutes without Cal video, 30 and 60 minutes with Cal video. Set this as false if you want to create a managed user and then manually create event types for the user.";
export class CreateOAuthClientInput {
  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  logo?: string;

  @IsString()
  @ApiProperty()
  name!: string;

  @IsArray()
  @IsString({ each: true })
  @ApiProperty({ type: [String] })
  redirectUris!: string[];

  @IsNumber()
  @ApiProperty()
  permissions!: number;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  bookingRedirectUri?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  bookingCancelRedirectUri?: string;

  @IsOptional()
  @IsString()
  @ApiPropertyOptional()
  bookingRescheduleRedirectUri?: string;

  @IsOptional()
  @IsBoolean()
  @ApiPropertyOptional()
  areEmailsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => value ?? false)
  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description: ARE_DEFAULT_EVENT_TYPES_ENABLED_DOCS,
  })
  areDefaultEventTypesEnabled? = false;
}
