export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      active_workspaces: {
        Row: {
          created_at: string
          id: string
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "active_workspaces_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id: string | null
          actor_type: string
          created_at: string
          id: string
          message: string | null
          metadata: Json | null
          resource_id: string | null
          resource_type: string
          result: Database["public"]["Enums"]["audit_result"]
          workspace_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          actor_id?: string | null
          actor_type: string
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type: string
          result: Database["public"]["Enums"]["audit_result"]
          workspace_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          actor_id?: string | null
          actor_type?: string
          created_at?: string
          id?: string
          message?: string | null
          metadata?: Json | null
          resource_id?: string | null
          resource_type?: string
          result?: Database["public"]["Enums"]["audit_result"]
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          billing_address: string | null
          company: string | null
          contact: Json
          created_at: string | null
          currency: string
          email: string
          favorite: boolean
          id: string
          internal_notes: string | null
          name: string
          owner_id: string | null
          payment_terms: string
          phone: string | null
          status: string
          tax_id: string | null
          updated_at: string | null
          website: string | null
          workspace_id: string | null
        }
        Insert: {
          billing_address?: string | null
          company?: string | null
          contact: Json
          created_at?: string | null
          currency: string
          email: string
          favorite: boolean
          id?: string
          internal_notes?: string | null
          name: string
          owner_id?: string | null
          payment_terms: string
          phone?: string | null
          status: string
          tax_id?: string | null
          updated_at?: string | null
          website?: string | null
          workspace_id?: string | null
        }
        Update: {
          billing_address?: string | null
          company?: string | null
          contact?: Json
          created_at?: string | null
          currency?: string
          email?: string
          favorite?: boolean
          id?: string
          internal_notes?: string | null
          name?: string
          owner_id?: string | null
          payment_terms?: string
          phone?: string | null
          status?: string
          tax_id?: string | null
          updated_at?: string | null
          website?: string | null
          workspace_id?: string | null
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
      collections_cases: {
        Row: {
          created_at: string
          escalation_status: Database["public"]["Enums"]["escalation_status"]
          id: string
          invoice_id: string
          last_action_at: string
          note: string | null
          owner_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          escalation_status: Database["public"]["Enums"]["escalation_status"]
          id?: string
          invoice_id: string
          last_action_at: string
          note?: string | null
          owner_id: string
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          escalation_status?: Database["public"]["Enums"]["escalation_status"]
          id?: string
          invoice_id?: string
          last_action_at?: string
          note?: string | null
          owner_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "collections_cases_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      email_events: {
        Row: {
          created_at: string
          delivery_event_id: string | null
          error: string | null
          event_type: Database["public"]["Enums"]["email_event_type"]
          id: string
          invoice_id: string | null
          owner_id: string | null
          provider: string
          provider_event_id: string | null
          provider_message_id: string | null
          raw_event: Json | null
          recipient: string | null
          subject: string | null
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          delivery_event_id?: string | null
          error?: string | null
          event_type: Database["public"]["Enums"]["email_event_type"]
          id?: string
          invoice_id?: string | null
          owner_id?: string | null
          provider: string
          provider_event_id?: string | null
          provider_message_id?: string | null
          raw_event?: Json | null
          recipient?: string | null
          subject?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          delivery_event_id?: string | null
          error?: string | null
          event_type?: Database["public"]["Enums"]["email_event_type"]
          id?: string
          invoice_id?: string | null
          owner_id?: string | null
          provider?: string
          provider_event_id?: string | null
          provider_message_id?: string | null
          raw_event?: Json | null
          recipient?: string | null
          subject?: string | null
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_events_delivery_event_id_fkey"
            columns: ["delivery_event_id"]
            isOneToOne: false
            referencedRelation: "invoice_delivery_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_connections: {
        Row: {
          access_token: string | null
          auth_type: string
          config_json: Json | null
          created_at: string
          default_revenue_account: string | null
          default_tax_code: string | null
          expires_at: string | null
          external_account_id: string | null
          id: string
          owner_id: string
          provider: Database["public"]["Enums"]["provider"]
          refresh_token: string | null
          status: string
          updated_at: string
          webhook_url: string | null
        }
        Insert: {
          access_token?: string | null
          auth_type: string
          config_json?: Json | null
          created_at?: string
          default_revenue_account?: string | null
          default_tax_code?: string | null
          expires_at?: string | null
          external_account_id?: string | null
          id?: string
          owner_id: string
          provider: Database["public"]["Enums"]["provider"]
          refresh_token?: string | null
          status: string
          updated_at?: string
          webhook_url?: string | null
        }
        Update: {
          access_token?: string | null
          auth_type?: string
          config_json?: Json | null
          created_at?: string
          default_revenue_account?: string | null
          default_tax_code?: string | null
          expires_at?: string | null
          external_account_id?: string | null
          id?: string
          owner_id?: string
          provider?: Database["public"]["Enums"]["provider"]
          refresh_token?: string | null
          status?: string
          updated_at?: string
          webhook_url?: string | null
        }
        Relationships: []
      }
      integration_logs: {
        Row: {
          created_at: string
          entity_id: string | null
          entity_type: string | null
          id: string
          level: string
          message: string
          owner_id: string
          provider: Database["public"]["Enums"]["provider"]
        }
        Insert: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          level: string
          message: string
          owner_id: string
          provider: Database["public"]["Enums"]["provider"]
        }
        Update: {
          created_at?: string
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          level?: string
          message?: string
          owner_id?: string
          provider?: Database["public"]["Enums"]["provider"]
        }
        Relationships: []
      }
      integration_sync_jobs: {
        Row: {
          created_at: string
          direction: string
          entity_id: string
          entity_type: string
          error: string | null
          id: string
          last_attempt_at: string | null
          owner_id: string
          provider: Database["public"]["Enums"]["provider"]
          request_payload: Json | null
          response_payload: Json | null
          retry_count: number
          status: Database["public"]["Enums"]["sync_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          direction: string
          entity_id: string
          entity_type: string
          error?: string | null
          id?: string
          last_attempt_at?: string | null
          owner_id: string
          provider: Database["public"]["Enums"]["provider"]
          request_payload?: Json | null
          response_payload?: Json | null
          retry_count: number
          status: Database["public"]["Enums"]["sync_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          direction?: string
          entity_id?: string
          entity_type?: string
          error?: string | null
          id?: string
          last_attempt_at?: string | null
          owner_id?: string
          provider?: Database["public"]["Enums"]["provider"]
          request_payload?: Json | null
          response_payload?: Json | null
          retry_count?: number
          status?: Database["public"]["Enums"]["sync_status"]
          updated_at?: string
        }
        Relationships: []
      }
      integration_webhooks: {
        Row: {
          active: boolean
          created_at: string
          endpoint: string
          id: string
          last_received_at: string | null
          owner_id: string
          provider: Database["public"]["Enums"]["provider"]
          secret: string | null
          updated_at: string
        }
        Insert: {
          active: boolean
          created_at?: string
          endpoint: string
          id?: string
          last_received_at?: string | null
          owner_id: string
          provider: Database["public"]["Enums"]["provider"]
          secret?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          endpoint?: string
          id?: string
          last_received_at?: string | null
          owner_id?: string
          provider?: Database["public"]["Enums"]["provider"]
          secret?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      invoice_delivery_events: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          invoice_id: string
          owner_id: string
          provider: string
          provider_message_id: string | null
          public_url: string | null
          recipient: string
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          invoice_id: string
          owner_id: string
          provider: string
          provider_message_id?: string | null
          public_url?: string | null
          recipient: string
          status: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          invoice_id?: string
          owner_id?: string
          provider?: string
          provider_message_id?: string | null
          public_url?: string | null
          recipient?: string
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_delivery_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_delivery_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_exports: {
        Row: {
          content: string
          created_at: string
          error: string | null
          file_name: string
          id: string
          invoice_id: string | null
          kind: string
          owner_id: string
          provider: Database["public"]["Enums"]["provider"] | null
          status: string
          updated_at: string
          workspace_id: string | null
        }
        Insert: {
          content: string
          created_at?: string
          error?: string | null
          file_name: string
          id?: string
          invoice_id?: string | null
          kind: string
          owner_id: string
          provider?: Database["public"]["Enums"]["provider"] | null
          status: string
          updated_at?: string
          workspace_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          error?: string | null
          file_name?: string
          id?: string
          invoice_id?: string | null
          kind?: string
          owner_id?: string
          provider?: Database["public"]["Enums"]["provider"] | null
          status?: string
          updated_at?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_exports_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_exports_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          bottom_block: Json | null
          canceled_at: string | null
          compliance: Json | null
          created_at: string
          currency: string
          customer_id: string | null
          customer_name: string
          customer_po_number: string | null
          date_format: string
          deleted_at: string | null
          delivered_at: string | null
          document_type: Database["public"]["Enums"]["invoice_document_type"]
          due_date: string
          finalized_at: string | null
          fiscalization: Json | null
          id: string
          internal_notes: string | null
          invoice_number: string
          invoice_size: string
          invoice_type: string
          issue_date: string
          lifecycle: Json | null
          line_items: Json
          logo_url: string | null
          notes: Json | null
          paid_at: string | null
          payment_amount: number
          payment_details: string | null
          payment_link: string | null
          payment_provider: Database["public"]["Enums"]["payment_source"] | null
          payment_reference: string | null
          payment_terms_days: number | null
          reminder: Json | null
          schedule_version: string | null
          scheduled_at: string | null
          shipment_details: Json | null
          status: Database["public"]["Enums"]["invoice_status"]
          sync: Json | null
          template: string | null
          template_settings: Json | null
          token: string
          token_revoked_at: string | null
          top_block: Json | null
          updated_at: string
          user_id: string | null
          workspace_id: string
        }
        Insert: {
          bottom_block?: Json | null
          canceled_at?: string | null
          compliance?: Json | null
          created_at?: string
          currency: string
          customer_id?: string | null
          customer_name: string
          customer_po_number?: string | null
          date_format?: string
          deleted_at?: string | null
          delivered_at?: string | null
          document_type?: Database["public"]["Enums"]["invoice_document_type"]
          due_date: string
          finalized_at?: string | null
          fiscalization?: Json | null
          id?: string
          internal_notes?: string | null
          invoice_number: string
          invoice_size?: string
          invoice_type?: string
          issue_date: string
          lifecycle?: Json | null
          line_items: Json
          logo_url?: string | null
          notes?: Json | null
          paid_at?: string | null
          payment_amount?: number
          payment_details?: string | null
          payment_link?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_source"]
            | null
          payment_reference?: string | null
          payment_terms_days?: number | null
          reminder?: Json | null
          schedule_version?: string | null
          scheduled_at?: string | null
          shipment_details?: Json | null
          status?: Database["public"]["Enums"]["invoice_status"]
          sync?: Json | null
          template?: string | null
          template_settings?: Json | null
          token: string
          token_revoked_at?: string | null
          top_block?: Json | null
          updated_at?: string
          user_id?: string | null
          workspace_id: string
        }
        Update: {
          bottom_block?: Json | null
          canceled_at?: string | null
          compliance?: Json | null
          created_at?: string
          currency?: string
          customer_id?: string | null
          customer_name?: string
          customer_po_number?: string | null
          date_format?: string
          deleted_at?: string | null
          delivered_at?: string | null
          document_type?: Database["public"]["Enums"]["invoice_document_type"]
          due_date?: string
          finalized_at?: string | null
          fiscalization?: Json | null
          id?: string
          internal_notes?: string | null
          invoice_number?: string
          invoice_size?: string
          invoice_type?: string
          issue_date?: string
          lifecycle?: Json | null
          line_items?: Json
          logo_url?: string | null
          notes?: Json | null
          paid_at?: string | null
          payment_amount?: number
          payment_details?: string | null
          payment_link?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_source"]
            | null
          payment_reference?: string | null
          payment_terms_days?: number | null
          reminder?: Json | null
          schedule_version?: string | null
          scheduled_at?: string | null
          shipment_details?: Json | null
          status?: Database["public"]["Enums"]["invoice_status"]
          sync?: Json | null
          template?: string | null
          template_settings?: Json | null
          token?: string
          token_revoked_at?: string | null
          top_block?: Json | null
          updated_at?: string
          user_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      job_runs: {
        Row: {
          completed_at: string
          created_at: string
          duration_ms: number
          error: string | null
          id: string
          job_name: string
          result_json: Json | null
          retries: number
          started_at: string
          status: Database["public"]["Enums"]["job_status"]
          workspace_id: string | null
        }
        Insert: {
          completed_at: string
          created_at?: string
          duration_ms: number
          error?: string | null
          id?: string
          job_name: string
          result_json?: Json | null
          retries: number
          started_at: string
          status: Database["public"]["Enums"]["job_status"]
          workspace_id?: string | null
        }
        Update: {
          completed_at?: string
          created_at?: string
          duration_ms?: number
          error?: string | null
          id?: string
          job_name?: string
          result_json?: Json | null
          retries?: number
          started_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      jurisdictions: {
        Row: {
          code: string
          default_tax_label: string
          name: string
          notes: string | null
          supports_reverse_charge: boolean
          supports_vat: boolean
          updated_at: string
        }
        Insert: {
          code: string
          default_tax_label: string
          name: string
          notes?: string | null
          supports_reverse_charge: boolean
          supports_vat: boolean
          updated_at?: string
        }
        Update: {
          code?: string
          default_tax_label?: string
          name?: string
          notes?: string | null
          supports_reverse_charge?: boolean
          supports_vat?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      payment_charges: {
        Row: {
          account_name: string | null
          account_number: string | null
          amount: number
          bank_name: string | null
          bank_slug: string | null
          created_at: string
          currency: string
          expires_at: string
          id: string
          invoice_id: string
          provider: string
          provider_message: string | null
          provider_status: string | null
          raw_response: Json | null
          reference: string
          status: Database["public"]["Enums"]["payment_charge_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          account_name?: string | null
          account_number?: string | null
          amount: number
          bank_name?: string | null
          bank_slug?: string | null
          created_at?: string
          currency: string
          expires_at: string
          id?: string
          invoice_id: string
          provider?: string
          provider_message?: string | null
          provider_status?: string | null
          raw_response?: Json | null
          reference: string
          status: Database["public"]["Enums"]["payment_charge_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          account_name?: string | null
          account_number?: string | null
          amount?: number
          bank_name?: string | null
          bank_slug?: string | null
          created_at?: string
          currency?: string
          expires_at?: string
          id?: string
          invoice_id?: string
          provider?: string
          provider_message?: string | null
          provider_status?: string | null
          raw_response?: Json | null
          reference?: string
          status?: Database["public"]["Enums"]["payment_charge_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_charges_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_charges_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          created_at: string
          currency: string
          customer_email: string | null
          event_type: string | null
          id: string
          invoice_id: string
          owner_id: string | null
          provider: string | null
          provider_payment_id: string | null
          provider_status: string | null
          raw_event: Json | null
          recorded_by: string | null
          reference: string | null
          source: Database["public"]["Enums"]["payment_source"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          currency: string
          customer_email?: string | null
          event_type?: string | null
          id?: string
          invoice_id: string
          owner_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          provider_status?: string | null
          raw_event?: Json | null
          recorded_by?: string | null
          reference?: string | null
          source: Database["public"]["Enums"]["payment_source"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          currency?: string
          customer_email?: string | null
          event_type?: string | null
          id?: string
          invoice_id?: string
          owner_id?: string | null
          provider?: string | null
          provider_payment_id?: string | null
          provider_status?: string | null
          raw_event?: Json | null
          recorded_by?: string | null
          reference?: string | null
          source?: Database["public"]["Enums"]["payment_source"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          created_at: string
          default_tax_id: string | null
          default_unit_price: number
          deleted_at: string | null
          description: string | null
          id: string
          is_active: boolean
          name: string
          sku: string | null
          type: string
          unit_name: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          default_tax_id?: string | null
          default_unit_price: number
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active: boolean
          name: string
          sku?: string | null
          type: string
          unit_name?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          default_tax_id?: string | null
          default_unit_price?: number
          deleted_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean
          name?: string
          sku?: string | null
          type?: string
          unit_name?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      public_rate_limit_windows: {
        Row: {
          key_hash: string
          request_count: number
          window_start: string
        }
        Insert: {
          key_hash: string
          request_count?: number
          window_start: string
        }
        Update: {
          key_hash?: string
          request_count?: number
          window_start?: string
        }
        Relationships: []
      }
      recurring_invoice_runs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          invoice_id: string | null
          period_key: string
          schedule_id: string
          status: Database["public"]["Enums"]["recurring_run_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          invoice_id?: string | null
          period_key: string
          schedule_id: string
          status: Database["public"]["Enums"]["recurring_run_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          invoice_id?: string | null
          period_key?: string
          schedule_id?: string
          status?: Database["public"]["Enums"]["recurring_run_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_invoice_runs_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoice_runs_schedule_id_fkey"
            columns: ["schedule_id"]
            isOneToOne: false
            referencedRelation: "recurring_invoice_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoice_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_invoice_schedules: {
        Row: {
          auto_send: boolean
          compliance: Json | null
          created_at: string
          currency: string
          customer_name: string
          date_format: string | null
          end_date: string | null
          frequency: Database["public"]["Enums"]["recurring_frequency"]
          generated_count: number
          id: string
          interval: number
          invoice_size: string | null
          last_generated_at: string | null
          last_generated_invoice_id: string | null
          last_generated_period: string | null
          line_items: Json
          logo_url: string | null
          name: string
          next_run_date: string
          notes: string | null
          owner_id: string
          payment_details: string | null
          payment_link: string | null
          payment_provider: Database["public"]["Enums"]["payment_source"] | null
          payment_terms_days: number
          start_date: string
          status: Database["public"]["Enums"]["recurring_schedule_status"]
          template: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auto_send: boolean
          compliance?: Json | null
          created_at?: string
          currency: string
          customer_name: string
          date_format?: string | null
          end_date?: string | null
          frequency: Database["public"]["Enums"]["recurring_frequency"]
          generated_count?: number
          id?: string
          interval: number
          invoice_size?: string | null
          last_generated_at?: string | null
          last_generated_invoice_id?: string | null
          last_generated_period?: string | null
          line_items: Json
          logo_url?: string | null
          name: string
          next_run_date: string
          notes?: string | null
          owner_id: string
          payment_details?: string | null
          payment_link?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_source"]
            | null
          payment_terms_days: number
          start_date: string
          status: Database["public"]["Enums"]["recurring_schedule_status"]
          template: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          auto_send?: boolean
          compliance?: Json | null
          created_at?: string
          currency?: string
          customer_name?: string
          date_format?: string | null
          end_date?: string | null
          frequency?: Database["public"]["Enums"]["recurring_frequency"]
          generated_count?: number
          id?: string
          interval?: number
          invoice_size?: string | null
          last_generated_at?: string | null
          last_generated_invoice_id?: string | null
          last_generated_period?: string | null
          line_items?: Json
          logo_url?: string | null
          name?: string
          next_run_date?: string
          notes?: string | null
          owner_id?: string
          payment_details?: string | null
          payment_link?: string | null
          payment_provider?:
            | Database["public"]["Enums"]["payment_source"]
            | null
          payment_terms_days?: number
          start_date?: string
          status?: Database["public"]["Enums"]["recurring_schedule_status"]
          template?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_invoice_schedules_last_generated_invoice_id_fkey"
            columns: ["last_generated_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_invoice_schedules_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_events: {
        Row: {
          channel: string
          created_at: string
          error: string | null
          id: string
          invoice_id: string
          meta: Json | null
          owner_id: string
          scheduled_for: string
          sent_at: string | null
          stage: Database["public"]["Enums"]["reminder_stage"]
          status: string
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          error?: string | null
          id?: string
          invoice_id: string
          meta?: Json | null
          owner_id: string
          scheduled_for: string
          sent_at?: string | null
          stage: Database["public"]["Enums"]["reminder_stage"]
          status: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          error?: string | null
          id?: string
          invoice_id?: string
          meta?: Json | null
          owner_id?: string
          scheduled_for?: string
          sent_at?: string | null
          stage?: Database["public"]["Enums"]["reminder_stage"]
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminder_events_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      reminder_rules: {
        Row: {
          business_signature: string | null
          created_at: string
          days_before_due: number
          enabled: boolean
          escalate_after_count: number
          id: string
          max_overdue_reminders: number
          on_due_date: boolean
          overdue_cadence_days: number
          owner_id: string
          updated_at: string
        }
        Insert: {
          business_signature?: string | null
          created_at?: string
          days_before_due: number
          enabled: boolean
          escalate_after_count: number
          id?: string
          max_overdue_reminders: number
          on_due_date: boolean
          overdue_cadence_days: number
          owner_id: string
          updated_at?: string
        }
        Update: {
          business_signature?: string | null
          created_at?: string
          days_before_due?: number
          enabled?: boolean
          escalate_after_count?: number
          id?: string
          max_overdue_reminders?: number
          on_due_date?: boolean
          overdue_cadence_days?: number
          owner_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      reminder_runs: {
        Row: {
          created_at: string
          escalated_count: number
          id: string
          notes: string | null
          owner_id: string
          queued_count: number
          run_date: string
          scanned_count: number
          sent_count: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          escalated_count: number
          id?: string
          notes?: string | null
          owner_id: string
          queued_count: number
          run_date: string
          scanned_count: number
          sent_count: number
          status: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          escalated_count?: number
          id?: string
          notes?: string | null
          owner_id?: string
          queued_count?: number
          run_date?: string
          scanned_count?: number
          sent_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      tax_profiles: {
        Row: {
          active: boolean
          created_at: string
          id: string
          is_default: boolean
          jurisdiction_code: string
          label: string
          name: string
          notes: string | null
          owner_id: string
          rate: number
          tax_treatment: Database["public"]["Enums"]["tax_treatment"]
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          jurisdiction_code: string
          label: string
          name: string
          notes?: string | null
          owner_id: string
          rate: number
          tax_treatment: Database["public"]["Enums"]["tax_treatment"]
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          is_default?: boolean
          jurisdiction_code?: string
          label?: string
          name?: string
          notes?: string | null
          owner_id?: string
          rate?: number
          tax_treatment?: Database["public"]["Enums"]["tax_treatment"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tax_profiles_jurisdiction_code_fkey"
            columns: ["jurisdiction_code"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["code"]
          },
        ]
      }
      tax_rule_sets: {
        Row: {
          authority: string
          created_at: string
          effective_from: string
          effective_to: string | null
          id: string
          is_current: boolean
          label: string
          updated_at: string
          vat_rate: number
        }
        Insert: {
          authority: string
          created_at?: string
          effective_from: string
          effective_to?: string | null
          id: string
          is_current?: boolean
          label: string
          updated_at?: string
          vat_rate: number
        }
        Update: {
          authority?: string
          created_at?: string
          effective_from?: string
          effective_to?: string | null
          id?: string
          is_current?: boolean
          label?: string
          updated_at?: string
          vat_rate?: number
        }
        Relationships: []
      }
      withholding_rates: {
        Row: {
          category: Database["public"]["Enums"]["withholding_category"]
          created_at: string
          non_resident_rate: number
          resident_rate: number
          rule_set_id: string
          updated_at: string
        }
        Insert: {
          category: Database["public"]["Enums"]["withholding_category"]
          created_at?: string
          non_resident_rate: number
          resident_rate: number
          rule_set_id: string
          updated_at?: string
        }
        Update: {
          category?: Database["public"]["Enums"]["withholding_category"]
          created_at?: string
          non_resident_rate?: number
          resident_rate?: number
          rule_set_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "withholding_rates_rule_set_id_fkey"
            columns: ["rule_set_id"]
            isOneToOne: false
            referencedRelation: "tax_rule_sets"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          address: string | null
          atrs: Json | null
          base_currency: string
          country_code: string
          created_at: string
          default_payment_link: string | null
          default_payment_terms_days: number | null
          default_tax_profile_id: string | null
          email: string | null
          id: string
          invoice_number_mode:
            | Database["public"]["Enums"]["invoice_number_mode"]
            | null
          invoice_number_prefix: string | null
          invoice_template_defaults: Json | null
          legal_name: string | null
          logo_url: string | null
          name: string
          next_invoice_sequence: number | null
          owner_id: string
          payment_details: string | null
          phone: string | null
          rc_number: string | null
          reminder_signature: string | null
          reminders_enabled: boolean
          seller_tax_status:
            | Database["public"]["Enums"]["seller_tax_status"]
            | null
          tax_id: string | null
          tax_rule_set_version: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          atrs?: Json | null
          base_currency: string
          country_code: string
          created_at?: string
          default_payment_link?: string | null
          default_payment_terms_days?: number | null
          default_tax_profile_id?: string | null
          email?: string | null
          id?: string
          invoice_number_mode?:
            | Database["public"]["Enums"]["invoice_number_mode"]
            | null
          invoice_number_prefix?: string | null
          invoice_template_defaults?: Json | null
          legal_name?: string | null
          logo_url?: string | null
          name: string
          next_invoice_sequence?: number | null
          owner_id: string
          payment_details?: string | null
          phone?: string | null
          rc_number?: string | null
          reminder_signature?: string | null
          reminders_enabled: boolean
          seller_tax_status?:
            | Database["public"]["Enums"]["seller_tax_status"]
            | null
          tax_id?: string | null
          tax_rule_set_version?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          atrs?: Json | null
          base_currency?: string
          country_code?: string
          created_at?: string
          default_payment_link?: string | null
          default_payment_terms_days?: number | null
          default_tax_profile_id?: string | null
          email?: string | null
          id?: string
          invoice_number_mode?:
            | Database["public"]["Enums"]["invoice_number_mode"]
            | null
          invoice_number_prefix?: string | null
          invoice_template_defaults?: Json | null
          legal_name?: string | null
          logo_url?: string | null
          name?: string
          next_invoice_sequence?: number | null
          owner_id?: string
          payment_details?: string | null
          phone?: string | null
          rc_number?: string | null
          reminder_signature?: string | null
          reminders_enabled?: boolean
          seller_tax_status?:
            | Database["public"]["Enums"]["seller_tax_status"]
            | null
          tax_id?: string | null
          tax_rule_set_version?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "workspaces_country_code_fkey"
            columns: ["country_code"]
            isOneToOne: false
            referencedRelation: "jurisdictions"
            referencedColumns: ["code"]
          },
          {
            foreignKeyName: "workspaces_default_tax_profile_owner_fkey"
            columns: ["default_tax_profile_id", "owner_id"]
            isOneToOne: false
            referencedRelation: "tax_profiles"
            referencedColumns: ["id", "owner_id"]
          },
          {
            foreignKeyName: "workspaces_tax_rule_set_version_fkey"
            columns: ["tax_rule_set_version"]
            isOneToOne: false
            referencedRelation: "tax_rule_sets"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      payment_charges_public: {
        Row: {
          amount: number | null
          created_at: string | null
          currency: string | null
          expires_at: string | null
          id: string | null
          invoice_id: string | null
          provider: string | null
          provider_message: string | null
          provider_status: string | null
          reference: string | null
          status: Database["public"]["Enums"]["payment_charge_status"] | null
          updated_at: string | null
          workspace_id: string | null
        }
        Insert: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string | null
          invoice_id?: string | null
          provider?: string | null
          provider_message?: string | null
          provider_status?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["payment_charge_status"] | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Update: {
          amount?: number | null
          created_at?: string | null
          currency?: string | null
          expires_at?: string | null
          id?: string | null
          invoice_id?: string | null
          provider?: string | null
          provider_message?: string | null
          provider_status?: string | null
          reference?: string | null
          status?: Database["public"]["Enums"]["payment_charge_status"] | null
          updated_at?: string | null
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "payment_charges_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_charges_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      confirm_paystack_payment: {
        Args: {
          input_amount: number
          input_currency: string
          input_customer_email?: string
          input_event_type: string
          input_provider_payment_id?: string
          input_provider_status: string
          input_raw_event?: Json
          input_reference: string
        }
        Returns: Json
      }
      custom_access_token_hook: { Args: { event: Json }; Returns: Json }
      consume_public_rate_limit: {
        Args: {
          input_key_hash: string
          input_limit: number
          input_window_start: string
        }
        Returns: boolean
      }
      public_invoice_by_token: { Args: { input_token: string }; Returns: Json }
    }
    Enums: {
      audit_action:
        | "invoice.created"
        | "invoice.edited"
        | "invoice.deleted"
        | "invoice.renumbered"
        | "invoice.paid"
        | "invoice.partially_paid"
        | "invoice.sent"
        | "invoice.viewed"
        | "invoice.converted"
        | "invoice.schedule_canceled"
        | "invoice.rescheduled"
        | "collection.session.created"
        | "collection.session.expired"
        | "payment.initiated"
        | "payment.received"
        | "payment.failed"
        | "reminder.sent"
        | "oauth.connected"
        | "integration.synced"
        | "export.created"
        | "export.retried"
        | "workspace.changed"
        | "workspace.selected"
      audit_result: "success" | "failure"
      compliance_warning:
        | "missing_seller_tax_id"
        | "missing_buyer_tax_id"
        | "cross_border_review"
        | "reverse_charge_review"
        | "unknown_jurisdiction"
        | "domestic_vat_not_applied"
        | "missing_workspace_tax_status"
        | "manual_tax_override"
        | "manual_wht_override"
        | "legacy_wht_mapping"
      email_event_type:
        | "sent"
        | "delivered"
        | "delivery_delayed"
        | "bounced"
        | "complained"
        | "opened"
        | "clicked"
        | "failed"
      escalation_status: "idle" | "queued" | "sent" | "manual_review"
      invoice_document_type: "standard" | "proforma"
      invoice_number_mode: "prefix" | "business_name"
      invoice_status:
        | "draft"
        | "unpaid"
        | "partially-paid"
        | "paid"
        | "overdue"
        | "canceled"
        | "scheduled"
      job_status: "success" | "failure"
      payment_charge_status:
        | "pending"
        | "succeeded"
        | "failed"
        | "expired"
        | "manual_review"
      payment_source: "manual" | "paystack"
      provider: "quickbooks" | "xero" | "slack"
      recurring_frequency: "monthly" | "quarterly"
      recurring_run_status: "created" | "skipped" | "failed"
      recurring_schedule_status: "active" | "paused" | "ended"
      reminder_stage:
        | "none"
        | "before_due"
        | "due_date"
        | "overdue_1"
        | "overdue_2"
        | "overdue_3"
        | "escalated"
      seller_tax_status:
        | "vat_registered"
        | "below_threshold_not_charging_vat"
        | "statutorily_exempt"
      sync_status:
        | "idle"
        | "pending"
        | "success"
        | "failed"
        | "needs_configuration"
      tax_treatment:
        | "none"
        | "exclusive_rate"
        | "inclusive_rate"
        | "reverse_charge"
        | "exempt"
        | "zero_rated"
      withholding_category:
        | "none"
        | "goods_materials"
        | "general_services"
        | "professional_fees"
        | "major_construction"
        | "other_construction"
        | "telecom_colocation"
        | "brokerage"
        | "rent_hire_lease"
      withholding_recipient_entity_type: "corporate" | "non_corporate"
      withholding_recipient_residency: "resident" | "non_resident"
      withholding_tax_preset:
        | "none"
        | "contracts_supplies"
        | "consultancy_company"
        | "consultancy_individual"
        | "rent_interest"
      workspace_role: "owner" | "member" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      audit_action: [
        "invoice.created",
        "invoice.edited",
        "invoice.deleted",
        "invoice.renumbered",
        "invoice.paid",
        "invoice.partially_paid",
        "invoice.sent",
        "invoice.viewed",
        "invoice.converted",
        "invoice.schedule_canceled",
        "invoice.rescheduled",
        "collection.session.created",
        "collection.session.expired",
        "payment.initiated",
        "payment.received",
        "payment.failed",
        "reminder.sent",
        "oauth.connected",
        "integration.synced",
        "export.created",
        "export.retried",
        "workspace.changed",
        "workspace.selected",
      ],
      audit_result: ["success", "failure"],
      compliance_warning: [
        "missing_seller_tax_id",
        "missing_buyer_tax_id",
        "cross_border_review",
        "reverse_charge_review",
        "unknown_jurisdiction",
        "domestic_vat_not_applied",
        "missing_workspace_tax_status",
        "manual_tax_override",
        "manual_wht_override",
        "legacy_wht_mapping",
      ],
      email_event_type: [
        "sent",
        "delivered",
        "delivery_delayed",
        "bounced",
        "complained",
        "opened",
        "clicked",
        "failed",
      ],
      escalation_status: ["idle", "queued", "sent", "manual_review"],
      invoice_document_type: ["standard", "proforma"],
      invoice_number_mode: ["prefix", "business_name"],
      invoice_status: [
        "draft",
        "unpaid",
        "partially-paid",
        "paid",
        "overdue",
        "canceled",
        "scheduled",
      ],
      job_status: ["success", "failure"],
      payment_charge_status: [
        "pending",
        "succeeded",
        "failed",
        "expired",
        "manual_review",
      ],
      payment_source: ["manual", "paystack"],
      provider: ["quickbooks", "xero", "slack"],
      recurring_frequency: ["monthly", "quarterly"],
      recurring_run_status: ["created", "skipped", "failed"],
      recurring_schedule_status: ["active", "paused", "ended"],
      reminder_stage: [
        "none",
        "before_due",
        "due_date",
        "overdue_1",
        "overdue_2",
        "overdue_3",
        "escalated",
      ],
      seller_tax_status: [
        "vat_registered",
        "below_threshold_not_charging_vat",
        "statutorily_exempt",
      ],
      sync_status: [
        "idle",
        "pending",
        "success",
        "failed",
        "needs_configuration",
      ],
      tax_treatment: [
        "none",
        "exclusive_rate",
        "inclusive_rate",
        "reverse_charge",
        "exempt",
        "zero_rated",
      ],
      withholding_category: [
        "none",
        "goods_materials",
        "general_services",
        "professional_fees",
        "major_construction",
        "other_construction",
        "telecom_colocation",
        "brokerage",
        "rent_hire_lease",
      ],
      withholding_recipient_entity_type: ["corporate", "non_corporate"],
      withholding_recipient_residency: ["resident", "non_resident"],
      withholding_tax_preset: [
        "none",
        "contracts_supplies",
        "consultancy_company",
        "consultancy_individual",
        "rent_interest",
      ],
      workspace_role: ["owner", "member", "viewer"],
    },
  },
} as const
