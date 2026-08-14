// Hand-written subset of the Verexa Tax Office v2 Supabase schema.
// Built from live schema inspected via Supabase MCP list_tables; covers
// only the tables this app reads/writes. Not a full generated types file.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export interface Database {
  public: {
    Tables: {
      workspaces: {
        Row: {
          id: string
          name: string
          slug: string
          workspace_type: string
          status: string
          timezone: string
          primary_contact_email: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          phone: string | null
          website: string | null
          mailing_address: string | null
          stripe_connected_account_id: string | null
          stripe_connect_account_type: string | null
          stripe_charges_enabled: boolean
          stripe_payouts_enabled: boolean
          stripe_details_submitted: boolean
          stripe_connect_status: string
          stripe_connect_updated_at: string | null
          suspension_reason: string | null
          onboarding_dismissed_at: string | null
        }
        Insert: {
          id?: string
          name: string
          slug: string
          workspace_type?: string
          status?: string
          timezone?: string
          primary_contact_email?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          phone?: string | null
          website?: string | null
          mailing_address?: string | null
          stripe_connected_account_id?: string | null
          stripe_connect_account_type?: string | null
          stripe_charges_enabled?: boolean
          stripe_payouts_enabled?: boolean
          stripe_details_submitted?: boolean
          stripe_connect_status?: string
          stripe_connect_updated_at?: string | null
          suspension_reason?: string | null
          onboarding_dismissed_at?: string | null
        }
        Update: {
          id?: string | null
          name?: string | null
          slug?: string | null
          workspace_type?: string | null
          status?: string | null
          timezone?: string | null
          primary_contact_email?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          phone?: string | null
          website?: string | null
          mailing_address?: string | null
          stripe_connected_account_id?: string | null
          stripe_connect_account_type?: string | null
          stripe_charges_enabled?: boolean | null
          stripe_payouts_enabled?: boolean | null
          stripe_details_submitted?: boolean | null
          stripe_connect_status?: string | null
          stripe_connect_updated_at?: string | null
          suspension_reason?: string | null
          onboarding_dismissed_at?: string | null
        }
        Relationships: []
      }
      workspace_users: {
        Row: {
          id: string
          workspace_id: string
          user_id: string
          role_id: string
          is_owner: boolean
          status: string
          invited_by: string | null
          invited_at: string | null
          joined_at: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          workspace_id: string
          user_id: string
          role_id: string
          is_owner?: boolean
          status?: string
          invited_by?: string | null
          invited_at?: string | null
          joined_at?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string | null
          workspace_id?: string | null
          user_id?: string | null
          role_id?: string | null
          is_owner?: boolean | null
          status?: string | null
          invited_by?: string | null
          invited_at?: string | null
          joined_at?: string | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspace_users_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_users_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_profiles: {
        Row: {
          id: string
          first_name: string | null
          last_name: string | null
          display_name: string | null
          phone: string | null
          avatar_url: string | null
          default_workspace_id: string | null
          is_platform_admin: boolean
          last_seen_at: string | null
          created_at: string
          updated_at: string
          failed_login_count: number
          locked_until: string | null
          mfa_enabled: boolean
          mfa_enrolled_at: string | null
          seen_onboarding_steps: string[]
          ptin_encrypted: string | null
          ptin_last4: string | null
          ptin_hash: string | null
        }
        Insert: {
          id: string
          first_name?: string | null
          last_name?: string | null
          display_name?: string | null
          phone?: string | null
          avatar_url?: string | null
          default_workspace_id?: string | null
          is_platform_admin?: boolean
          last_seen_at?: string | null
          created_at?: string
          updated_at?: string
          failed_login_count?: number
          locked_until?: string | null
          mfa_enabled?: boolean
          mfa_enrolled_at?: string | null
          seen_onboarding_steps?: string[]
          ptin_encrypted?: string | null
          ptin_last4?: string | null
          ptin_hash?: string | null
        }
        Update: {
          id?: string | null
          first_name?: string | null
          last_name?: string | null
          display_name?: string | null
          phone?: string | null
          avatar_url?: string | null
          default_workspace_id?: string | null
          is_platform_admin?: boolean | null
          last_seen_at?: string | null
          created_at?: string | null
          updated_at?: string | null
          failed_login_count?: number | null
          locked_until?: string | null
          mfa_enabled?: boolean | null
          mfa_enrolled_at?: string | null
          seen_onboarding_steps?: string[] | null
          ptin_encrypted?: string | null
          ptin_last4?: string | null
          ptin_hash?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          workspace_id: string
          client_type: string
          lifecycle_status: string
          first_name: string | null
          last_name: string | null
          business_name: string | null
          date_of_birth: string | null
          primary_email: string | null
          primary_phone: string | null
          address_line1: string | null
          address_line2: string | null
          city: string | null
          state: string | null
          postal_code: string | null
          country: string
          ssn_encrypted: string | null
          ssn_last4: string | null
          ssn_hash: string | null
          ein_encrypted: string | null
          ein_last4: string | null
          ein_hash: string | null
          itin_encrypted: string | null
          itin_last4: string | null
          itin_hash: string | null
          normalized_email: string | null
          normalized_phone: string | null
          has_portal_access: boolean
          tags: string[]
          custom_fields: Json
          notes: string | null
          merged_into_client_id: string | null
          created_by: string | null
          created_at: string
          updated_at: string
          search_vector: string | null
          relationship_manager_id: string | null
          default_reviewer_id: string | null
          default_compliance_officer_id: string | null
          client_number: string | null
          source_workspace_id: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          client_type?: string
          lifecycle_status?: string
          first_name?: string | null
          last_name?: string | null
          business_name?: string | null
          date_of_birth?: string | null
          primary_email?: string | null
          primary_phone?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          postal_code?: string | null
          country?: string
          ssn_encrypted?: string | null
          ssn_last4?: string | null
          ssn_hash?: string | null
          ein_encrypted?: string | null
          ein_last4?: string | null
          ein_hash?: string | null
          itin_encrypted?: string | null
          itin_last4?: string | null
          itin_hash?: string | null
          normalized_email?: string | null
          normalized_phone?: string | null
          has_portal_access?: boolean
          tags?: string[]
          custom_fields?: Json
          notes?: string | null
          merged_into_client_id?: string | null
          created_by?: string | null
          created_at?: string
          updated_at?: string
          relationship_manager_id?: string | null
          default_reviewer_id?: string | null
          default_compliance_officer_id?: string | null
          client_number?: string | null
          source_workspace_id?: string | null
        }
        Update: {
          id?: string | null
          workspace_id?: string | null
          client_type?: string | null
          lifecycle_status?: string | null
          first_name?: string | null
          last_name?: string | null
          business_name?: string | null
          date_of_birth?: string | null
          primary_email?: string | null
          primary_phone?: string | null
          address_line1?: string | null
          address_line2?: string | null
          city?: string | null
          state?: string | null
          postal_code?: string | null
          country?: string | null
          ssn_encrypted?: string | null
          ssn_last4?: string | null
          ssn_hash?: string | null
          ein_encrypted?: string | null
          ein_last4?: string | null
          ein_hash?: string | null
          itin_encrypted?: string | null
          itin_last4?: string | null
          itin_hash?: string | null
          normalized_email?: string | null
          normalized_phone?: string | null
          has_portal_access?: boolean | null
          tags?: string[] | null
          custom_fields?: Json | null
          notes?: string | null
          merged_into_client_id?: string | null
          created_by?: string | null
          created_at?: string | null
          updated_at?: string | null
          relationship_manager_id?: string | null
          default_reviewer_id?: string | null
          default_compliance_officer_id?: string | null
          client_number?: string | null
          source_workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_contacts: {
        Row: {
          id: string
          client_id: string
          workspace_id: string
          first_name: string | null
          last_name: string | null
          title: string | null
          email: string | null
          phone: string | null
          preferred_contact_method: string | null
          is_primary: boolean
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          workspace_id: string
          first_name?: string | null
          last_name?: string | null
          title?: string | null
          email?: string | null
          phone?: string | null
          preferred_contact_method?: string | null
          is_primary?: boolean
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string | null
          client_id?: string | null
          workspace_id?: string | null
          first_name?: string | null
          last_name?: string | null
          title?: string | null
          email?: string | null
          phone?: string | null
          preferred_contact_method?: string | null
          is_primary?: boolean | null
          display_order?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_contacts_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_contacts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_addresses: {
        Row: {
          id: string
          client_id: string
          workspace_id: string
          address_type: string
          street: string | null
          city: string | null
          state: string | null
          zip: string | null
          is_primary: boolean
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          workspace_id: string
          address_type?: string
          street?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          is_primary?: boolean
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string | null
          client_id?: string | null
          workspace_id?: string | null
          address_type?: string | null
          street?: string | null
          city?: string | null
          state?: string | null
          zip?: string | null
          is_primary?: boolean | null
          display_order?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_addresses_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_addresses_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_phones: {
        Row: {
          id: string
          client_id: string
          workspace_id: string
          phone_type: string
          phone_number: string
          is_primary: boolean
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          workspace_id: string
          phone_type?: string
          phone_number: string
          is_primary?: boolean
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string | null
          client_id?: string | null
          workspace_id?: string | null
          phone_type?: string | null
          phone_number?: string | null
          is_primary?: boolean | null
          display_order?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_phones_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_phones_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_emails: {
        Row: {
          id: string
          client_id: string
          workspace_id: string
          email_type: string
          email: string
          is_primary: boolean
          display_order: number
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          client_id: string
          workspace_id: string
          email_type?: string
          email: string
          is_primary?: boolean
          display_order?: number
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string | null
          client_id?: string | null
          workspace_id?: string | null
          email_type?: string | null
          email?: string | null
          is_primary?: boolean | null
          display_order?: number | null
          created_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "client_emails_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_emails_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      notes: {
        Row: {
          id: string
          entity_id: string
          workspace_id: string
          author_id: string | null
          body: string
          is_pinned: boolean
          created_at: string
          updated_at: string
          entity_type: string
          is_private: boolean
          is_internal: boolean
          rich_content: Json | null
          mentions: Json | null
          attachments: Json | null
          search_vector: string | null
          subject: string | null
        }
        Insert: {
          id?: string
          entity_id: string
          workspace_id: string
          author_id?: string | null
          body: string
          is_pinned?: boolean
          created_at?: string
          updated_at?: string
          entity_type?: string
          is_private?: boolean
          is_internal?: boolean
          rich_content?: Json | null
          mentions?: Json | null
          attachments?: Json | null
          subject?: string | null
        }
        Update: {
          id?: string | null
          entity_id?: string | null
          workspace_id?: string | null
          author_id?: string | null
          body?: string | null
          is_pinned?: boolean | null
          created_at?: string | null
          updated_at?: string | null
          entity_type?: string | null
          is_private?: boolean | null
          is_internal?: boolean | null
          rich_content?: Json | null
          mentions?: Json | null
          attachments?: Json | null
          subject?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "notes_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      attachments: {
        Row: {
          id: string
          entity_id: string
          workspace_id: string
          file_name: string
          storage_path: string
          file_size_bytes: number | null
          mime_type: string | null
          uploaded_by: string | null
          created_at: string
          entity_type: string
          category: string | null
          tags: string[] | null
          version: number | null
          search_vector: string | null
          folder_id: string | null
          is_favorite: boolean
          is_archived: boolean
          visibility: string
          replaces_attachment_id: string | null
          is_latest_version: boolean
          is_locked: boolean
          ai_metadata: Json | null
        }
        Insert: {
          id?: string
          entity_id: string
          workspace_id: string
          file_name: string
          storage_path: string
          file_size_bytes?: number | null
          mime_type?: string | null
          uploaded_by?: string | null
          created_at?: string
          entity_type?: string
          category?: string | null
          tags?: string[] | null
          version?: number | null
          folder_id?: string | null
          is_favorite?: boolean
          is_archived?: boolean
          visibility?: string
          replaces_attachment_id?: string | null
          is_latest_version?: boolean
          is_locked?: boolean
          ai_metadata?: Json | null
        }
        Update: {
          id?: string | null
          entity_id?: string | null
          workspace_id?: string | null
          file_name?: string | null
          storage_path?: string | null
          file_size_bytes?: number | null
          mime_type?: string | null
          uploaded_by?: string | null
          created_at?: string | null
          entity_type?: string | null
          category?: string | null
          tags?: string[] | null
          version?: number | null
          folder_id?: string | null
          is_favorite?: boolean | null
          is_archived?: boolean | null
          visibility?: string | null
          replaces_attachment_id?: string | null
          is_latest_version?: boolean | null
          is_locked?: boolean | null
          ai_metadata?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "attachments_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      engagements: {
        Row: {
          id: string
          created_at: string | null
          client_id: string
          workspace_id: string
          workflow_id: string | null
          current_stage: string | null
          priority: string | null
          review_status: string | null
          assigned_staff_id: string | null
          reviewer_id: string | null
          compliance_officer_id: string | null
          owner_workspace_id: string | null
          shared_status: string | null
          open_date: string | null
          due_date: string | null
          completed_date: string | null
          archived_date: string | null
          internal_reference: string | null
          engagement_number: string | null
          service_id: string | null
          updated_at: string
          status: string
          search_vector: string | null
          billing_rule_id: string | null
          source_engagement_share_id: string | null
          case_type: string
        }
        Insert: {
          id?: string
          created_at?: string | null
          client_id: string
          workspace_id: string
          workflow_id?: string | null
          current_stage?: string | null
          priority?: string | null
          review_status?: string | null
          assigned_staff_id?: string | null
          reviewer_id?: string | null
          compliance_officer_id?: string | null
          owner_workspace_id?: string | null
          shared_status?: string | null
          open_date?: string | null
          due_date?: string | null
          completed_date?: string | null
          archived_date?: string | null
          internal_reference?: string | null
          engagement_number?: string | null
          service_id?: string | null
          updated_at?: string
          status?: string
          billing_rule_id?: string | null
          source_engagement_share_id?: string | null
          case_type?: string
        }
        Update: {
          id?: string | null
          created_at?: string | null
          client_id?: string | null
          workspace_id?: string | null
          workflow_id?: string | null
          current_stage?: string | null
          priority?: string | null
          review_status?: string | null
          assigned_staff_id?: string | null
          reviewer_id?: string | null
          compliance_officer_id?: string | null
          owner_workspace_id?: string | null
          shared_status?: string | null
          open_date?: string | null
          due_date?: string | null
          completed_date?: string | null
          archived_date?: string | null
          internal_reference?: string | null
          engagement_number?: string | null
          service_id?: string | null
          updated_at?: string | null
          status?: string | null
          billing_rule_id?: string | null
          source_engagement_share_id?: string | null
          case_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engagements_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagements_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_tax_details: {
        Row: {
          engagement_id: string
          workspace_id: string
          tax_year: number | null
          return_type: string | null
          is_amended: boolean
          original_engagement_id: string | null
          is_extended: boolean
          extension_filed_date: string | null
          extension_due_date: string | null
          efile_status: string
          efile_transmitted_at: string | null
          efile_accepted_at: string | null
          efile_rejected_reason: string | null
          created_at: string
          updated_at: string
          filing_status: string | null
          federal_refund_amount: number | null
          federal_balance_due: number | null
        }
        Insert: {
          engagement_id: string
          workspace_id: string
          tax_year?: number | null
          return_type?: string | null
          is_amended?: boolean
          original_engagement_id?: string | null
          is_extended?: boolean
          extension_filed_date?: string | null
          extension_due_date?: string | null
          efile_status?: string
          efile_transmitted_at?: string | null
          efile_accepted_at?: string | null
          efile_rejected_reason?: string | null
          created_at?: string
          updated_at?: string
          filing_status?: string | null
          federal_refund_amount?: number | null
          federal_balance_due?: number | null
        }
        Update: {
          engagement_id?: string | null
          workspace_id?: string | null
          tax_year?: number | null
          return_type?: string | null
          is_amended?: boolean | null
          original_engagement_id?: string | null
          is_extended?: boolean | null
          extension_filed_date?: string | null
          extension_due_date?: string | null
          efile_status?: string | null
          efile_transmitted_at?: string | null
          efile_accepted_at?: string | null
          efile_rejected_reason?: string | null
          created_at?: string | null
          updated_at?: string | null
          filing_status?: string | null
          federal_refund_amount?: number | null
          federal_balance_due?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_tax_details_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_tax_details_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      engagement_status_history: {
        Row: {
          id: string
          engagement_id: string
          old_status: string | null
          new_status: string
          changed_by: string | null
          changed_at: string | null
          reason: string | null
          audit_reference: string | null
        }
        Insert: {
          id?: string
          engagement_id: string
          old_status?: string | null
          new_status: string
          changed_by?: string | null
          changed_at?: string | null
          reason?: string | null
          audit_reference?: string | null
        }
        Update: {
          id?: string | null
          engagement_id?: string | null
          old_status?: string | null
          new_status?: string | null
          changed_by?: string | null
          changed_at?: string | null
          reason?: string | null
          audit_reference?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "engagement_status_history_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "engagement_status_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      tasks: {
        Row: {
          id: string
          workflow_stage_id: string | null
          engagement_id: string
          title: string
          description: string | null
          status: string
          assigned_staff_id: string | null
          due_date: string | null
          completed_at: string | null
          priority: string | null
          created_at: string | null
          updated_at: string | null
          workspace_id: string
        }
        Insert: {
          id?: string
          workflow_stage_id?: string | null
          engagement_id: string
          title: string
          description?: string | null
          status?: string
          assigned_staff_id?: string | null
          due_date?: string | null
          completed_at?: string | null
          priority?: string | null
          created_at?: string | null
          updated_at?: string | null
          workspace_id: string
        }
        Update: {
          id?: string | null
          workflow_stage_id?: string | null
          engagement_id?: string | null
          title?: string | null
          description?: string | null
          status?: string | null
          assigned_staff_id?: string | null
          due_date?: string | null
          completed_at?: string | null
          priority?: string | null
          created_at?: string | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tasks_engagement_id_fkey"
            columns: ["engagement_id"]
            isOneToOne: false
            referencedRelation: "engagements"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tasks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      activity_log: {
        Row: {
          id: string
          workspace_id: string
          actor_id: string | null
          entity_type: string
          entity_id: string | null
          activity_type: string
          description: string
          metadata: Json
          created_at: string
          event_type: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          actor_id?: string | null
          entity_type: string
          entity_id?: string | null
          activity_type: string
          description: string
          metadata?: Json
          created_at?: string
          event_type?: string | null
        }
        Update: {
          id?: string | null
          workspace_id?: string | null
          actor_id?: string | null
          entity_type?: string | null
          entity_id?: string | null
          activity_type?: string | null
          description?: string | null
          metadata?: Json | null
          created_at?: string | null
          event_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      branding: {
        Row: {
          workspace_id: string
          display_name: string | null
          logo_url: string | null
          primary_color: string
          secondary_color: string
          accent_color: string
          portal_subdomain: string | null
          custom_domain: string | null
          email_from_name: string | null
          support_email: string | null
          support_phone: string | null
          updated_at: string
          dba: string | null
          sidebar_logo_url: string | null
          portal_logo_url: string | null
          email_header_logo_url: string | null
          pdf_header_logo_url: string | null
          business_phone: string | null
          business_email: string | null
          website_url: string | null
          theme_mode: string
          reply_to_email: string | null
          billing_email: string | null
          notification_email: string | null
          sidebar_text_color: string | null
        }
        Insert: {
          workspace_id: string
          display_name?: string | null
          logo_url?: string | null
          primary_color?: string
          secondary_color?: string
          accent_color?: string
          portal_subdomain?: string | null
          custom_domain?: string | null
          email_from_name?: string | null
          support_email?: string | null
          support_phone?: string | null
          updated_at?: string
          dba?: string | null
          sidebar_logo_url?: string | null
          portal_logo_url?: string | null
          email_header_logo_url?: string | null
          pdf_header_logo_url?: string | null
          business_phone?: string | null
          business_email?: string | null
          website_url?: string | null
          theme_mode?: string
          reply_to_email?: string | null
          billing_email?: string | null
          notification_email?: string | null
          sidebar_text_color?: string | null
        }
        Update: {
          workspace_id?: string | null
          display_name?: string | null
          logo_url?: string | null
          primary_color?: string | null
          secondary_color?: string | null
          accent_color?: string | null
          portal_subdomain?: string | null
          custom_domain?: string | null
          email_from_name?: string | null
          support_email?: string | null
          support_phone?: string | null
          updated_at?: string | null
          dba?: string | null
          sidebar_logo_url?: string | null
          portal_logo_url?: string | null
          email_header_logo_url?: string | null
          pdf_header_logo_url?: string | null
          business_phone?: string | null
          business_email?: string | null
          website_url?: string | null
          theme_mode?: string | null
          reply_to_email?: string | null
          billing_email?: string | null
          notification_email?: string | null
          sidebar_text_color?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "branding_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

type PublicSchema = Database["public"]
export type Tables<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> = PublicSchema["Tables"][T]["Update"]
