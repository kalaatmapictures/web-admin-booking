/**
 * Tipe TypeScript untuk skema database (supabase/migrations).
 *
 * Ditulis manual mengikuti format `supabase gen types typescript`. Setelah
 * project Supabase tersedia, file ini bisa diganti hasil generate:
 *   npx supabase gen types typescript --project-id <PROJECT_REF> > src/types/database.ts
 * Jika skema SQL berubah, perbarui file ini juga.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ProjectStatus = "draft" | "active" | "archived";
export type SelectionStatus = "open" | "submitted" | "locked";

/** Satu entri di `selection_submissions.photos`. */
export type SubmissionPhoto = {
  photo_id: string;
  photo_code: string;
  file_name: string;
  drive_file_id: string;
};

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "12";
  };
  public: {
    Tables: {
      selection_admins: {
        Row: {
          user_id: string;
          display_name: string;
          created_at: string;
        };
        Insert: {
          user_id: string;
          display_name: string;
          created_at?: string;
        };
        Update: {
          user_id?: string;
          display_name?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          client_name: string;
          event_type: string;
          event_date: string | null;
          internal_notes: string | null;
          drive_folder_id: string | null;
          drive_folder_name: string | null;
          last_synced_at: string | null;
          photo_quota: number;
          selection_deadline: string | null;
          status: ProjectStatus;
          selection_status: SelectionStatus;
          selection_submitted_at: string | null;
          selection_locked_at: string | null;
          gallery_token_hash: string | null;
          gallery_token_created_at: string | null;
          gallery_token_revoked_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          archived_at: string | null;
        };
        Insert: {
          id?: string;
          client_name: string;
          event_type: string;
          event_date?: string | null;
          internal_notes?: string | null;
          drive_folder_id?: string | null;
          drive_folder_name?: string | null;
          last_synced_at?: string | null;
          photo_quota: number;
          selection_deadline?: string | null;
          status?: ProjectStatus;
          selection_status?: SelectionStatus;
          selection_submitted_at?: string | null;
          selection_locked_at?: string | null;
          gallery_token_hash?: string | null;
          gallery_token_created_at?: string | null;
          gallery_token_revoked_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          archived_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["projects"]["Insert"]>;
        Relationships: [];
      };
      project_photos: {
        Row: {
          id: string;
          project_id: string;
          drive_file_id: string;
          file_name: string;
          mime_type: string;
          photo_code: string;
          size_bytes: number | null;
          width: number | null;
          height: number | null;
          md5_checksum: string | null;
          drive_created_at: string | null;
          drive_modified_at: string | null;
          sort_order: number;
          is_available: boolean;
          unavailable_since: string | null;
          last_seen_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          drive_file_id: string;
          file_name: string;
          mime_type: string;
          photo_code: string;
          size_bytes?: number | null;
          width?: number | null;
          height?: number | null;
          md5_checksum?: string | null;
          drive_created_at?: string | null;
          drive_modified_at?: string | null;
          sort_order?: number;
          is_available?: boolean;
          unavailable_since?: string | null;
          last_seen_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["project_photos"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "project_photos_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
      photo_selections: {
        Row: {
          id: string;
          project_id: string;
          photo_id: string;
          selected_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          photo_id: string;
          selected_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["photo_selections"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "photo_selections_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "photo_selections_photo_fkey";
            columns: ["project_id", "photo_id"];
            isOneToOne: false;
            referencedRelation: "project_photos";
            referencedColumns: ["project_id", "id"];
          },
        ];
      };
      selection_submissions: {
        Row: {
          id: string;
          project_id: string;
          submission_number: number;
          photo_count: number;
          photo_quota: number;
          photos: Json;
          client_note: string | null;
          submitted_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          submission_number: number;
          photo_count: number;
          photo_quota: number;
          photos: Json;
          client_note?: string | null;
          submitted_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["selection_submissions"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "selection_submissions_project_id_fkey";
            columns: ["project_id"];
            isOneToOne: false;
            referencedRelation: "projects";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      is_selection_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      submit_selection: {
        Args: { p_project_id: string; p_client_note?: string | null };
        Returns: Database["public"]["Tables"]["selection_submissions"]["Row"];
      };
    };
    Enums: {
      project_status: ProjectStatus;
      selection_status: SelectionStatus;
    };
    CompositeTypes: { [_ in never]: never };
  };
};

export type Tables<T extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][T]["Row"];

export type Project = Tables<"projects">;
export type ProjectPhoto = Tables<"project_photos">;
export type PhotoSelection = Tables<"photo_selections">;
export type SelectionSubmission = Tables<"selection_submissions">;
