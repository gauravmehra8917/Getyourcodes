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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity: string
          entity_id: string | null
          id: string
          meta: Json
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity: string
          entity_id?: string | null
          id?: string
          meta?: Json
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity?: string
          entity_id?: string | null
          id?: string
          meta?: Json
        }
        Relationships: []
      }
      ads: {
        Row: {
          active: boolean
          created_at: string
          html: string | null
          id: string
          image_url: string | null
          link_url: string | null
          name: string
          placement: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          html?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          name: string
          placement?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          html?: string | null
          id?: string
          image_url?: string | null
          link_url?: string | null
          name?: string
          placement?: string
          updated_at?: string
        }
        Relationships: []
      }
      affiliate_import_runs: {
        Row: {
          api_calls_used: number
          created_at: string
          duration_ms: number
          error_message: string | null
          finished_at: string | null
          id: string
          integration_id: string
          import_strategy: string
          existing_provider_identities: number
          new_provider_identities: number
          pages_crawled: number
          policy_id: string | null
          policy_name: string | null
          preview: boolean
          provider: string
          publishing_policy_id: string | null
          publishing_policy_name: string | null
          publishing_summary: Json
          records_created: number
          records_fetched: number
          records_held: number
          records_processed: number
          records_published: number
          records_skipped: number
          records_updated: number
          started_at: string
          statistics: Json
          success: boolean
          stop_reason: string | null
          triggered_by: string | null
          validation_errors: number
          warnings: number
        }
        Insert: {
          created_at?: string
          api_calls_used?: number
          duration_ms?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          integration_id: string
          import_strategy?: string
          existing_provider_identities?: number
          new_provider_identities?: number
          pages_crawled?: number
          policy_id?: string | null
          policy_name?: string | null
          preview?: boolean
          provider: string
          publishing_policy_id?: string | null
          publishing_policy_name?: string | null
          publishing_summary?: Json
          records_created?: number
          records_fetched?: number
          records_held?: number
          records_processed?: number
          records_published?: number
          records_skipped?: number
          records_updated?: number
          started_at?: string
          statistics?: Json
          success?: boolean
          stop_reason?: string | null
          triggered_by?: string | null
          validation_errors?: number
          warnings?: number
        }
        Update: {
          created_at?: string
          api_calls_used?: number
          duration_ms?: number
          error_message?: string | null
          finished_at?: string | null
          id?: string
          integration_id?: string
          import_strategy?: string
          existing_provider_identities?: number
          new_provider_identities?: number
          pages_crawled?: number
          policy_id?: string | null
          policy_name?: string | null
          preview?: boolean
          provider?: string
          publishing_policy_id?: string | null
          publishing_policy_name?: string | null
          publishing_summary?: Json
          records_created?: number
          records_fetched?: number
          records_held?: number
          records_processed?: number
          records_published?: number
          records_skipped?: number
          records_updated?: number
          started_at?: string
          statistics?: Json
          success?: boolean
          stop_reason?: string | null
          triggered_by?: string | null
          validation_errors?: number
          warnings?: number
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_import_runs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "affiliate_integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "affiliate_import_runs_publishing_policy_id_fkey"
            columns: ["publishing_policy_id"]
            isOneToOne: false
            referencedRelation: "publishing_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_integration_credentials: {
        Row: {
          ciphertext: string
          created_at: string
          id: string
          integration_id: string | null
          updated_at: string
        }
        Insert: {
          ciphertext: string
          created_at?: string
          id?: string
          integration_id?: string | null
          updated_at?: string
        }
        Update: {
          ciphertext?: string
          created_at?: string
          id?: string
          integration_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_integration_credentials_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "affiliate_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_integration_tests: {
        Row: {
          auth_status: string | null
          created_at: string
          environment: string | null
          http_status: number | null
          id: string
          integration_id: string
          latency_ms: number | null
          message: string | null
          status: string
          tested_by: string | null
        }
        Insert: {
          auth_status?: string | null
          created_at?: string
          environment?: string | null
          http_status?: number | null
          id?: string
          integration_id: string
          latency_ms?: number | null
          message?: string | null
          status: string
          tested_by?: string | null
        }
        Update: {
          auth_status?: string | null
          created_at?: string
          environment?: string | null
          http_status?: number | null
          id?: string
          integration_id?: string
          latency_ms?: number | null
          message?: string | null
          status?: string
          tested_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_integration_tests_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "affiliate_integrations"
            referencedColumns: ["id"]
          },
        ]
      }
      affiliate_integrations: {
        Row: {
          api_version: string | null
          authentication_type: string
          base_url: string
          created_at: string
          created_by: string | null
          credential_reference: string | null
          custom_headers: Json
          description: string | null
          endpoint_configuration: Json
          environment: string
          id: string
          integration_name: string
          orchestration_max_api_calls: number | null
          orchestration_max_pages: number | null
          orchestration_no_new_pages: number
          orchestration_page_size: number
          orchestration_strategy: string
          is_enabled: boolean
          last_test_result: Json | null
          last_tested_at: string | null
          provider_name: string
          provider_type: string
          publishing_policy_id: string | null
          retry_attempts: number
          status: string
          timeout_seconds: number
          updated_at: string
        }
        Insert: {
          api_version?: string | null
          authentication_type: string
          base_url: string
          created_at?: string
          created_by?: string | null
          credential_reference?: string | null
          custom_headers?: Json
          description?: string | null
          endpoint_configuration?: Json
          environment?: string
          id?: string
          integration_name: string
          orchestration_max_api_calls?: number | null
          orchestration_max_pages?: number | null
          orchestration_no_new_pages?: number
          orchestration_page_size?: number
          orchestration_strategy?: string
          is_enabled?: boolean
          last_test_result?: Json | null
          last_tested_at?: string | null
          provider_name: string
          provider_type: string
          publishing_policy_id?: string | null
          retry_attempts?: number
          status?: string
          timeout_seconds?: number
          updated_at?: string
        }
        Update: {
          api_version?: string | null
          authentication_type?: string
          base_url?: string
          created_at?: string
          created_by?: string | null
          credential_reference?: string | null
          custom_headers?: Json
          description?: string | null
          endpoint_configuration?: Json
          environment?: string
          id?: string
          integration_name?: string
          orchestration_max_api_calls?: number | null
          orchestration_max_pages?: number | null
          orchestration_no_new_pages?: number
          orchestration_page_size?: number
          orchestration_strategy?: string
          is_enabled?: boolean
          last_test_result?: Json | null
          last_tested_at?: string | null
          provider_name?: string
          provider_type?: string
          publishing_policy_id?: string | null
          retry_attempts?: number
          status?: string
          timeout_seconds?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "affiliate_integrations_publishing_policy_id_fkey"
            columns: ["publishing_policy_id"]
            isOneToOne: false
            referencedRelation: "publishing_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      blog_categories: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          created_at: string
          id: string
          imported_at: string | null
          name: string
          provider: string | null
          provider_entity_id: string | null
          seo_canonical_url: string | null
          seo_description: string | null
          seo_og_image: string | null
          seo_robots: string
          seo_title: string | null
          slug: string
        }
        Insert: {
          created_at?: string
          id?: string
          imported_at?: string | null
          name: string
          provider?: string | null
          provider_entity_id?: string | null
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          slug: string
        }
        Update: {
          created_at?: string
          id?: string
          imported_at?: string | null
          name?: string
          provider?: string | null
          provider_entity_id?: string | null
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          slug?: string
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          parts: Json
          role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          parts: Json
          role: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          parts?: Json
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      coupon_clicks: {
        Row: {
          clicked_at: string
          coupon_id: string
          id: string
          source_page: string | null
          user_id: string | null
        }
        Insert: {
          clicked_at?: string
          coupon_id: string
          id?: string
          source_page?: string | null
          user_id?: string | null
        }
        Update: {
          clicked_at?: string
          coupon_id?: string
          id?: string
          source_page?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "coupon_clicks_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      coupons: {
        Row: {
          affiliate_url: string | null
          coupon_code: string | null
          coupon_type: Database["public"]["Enums"]["coupon_type"]
          created_at: string
          description: string | null
          discount_type: string | null
          discount_value: number | null
          expiry_date: string | null
          featured_in_banner: boolean
          id: string
          imported_at: string | null
          landing_page_url: string | null
          metadata: Json
          provider: string | null
          provider_entity_id: string | null
          seo_canonical_url: string | null
          seo_description: string | null
          seo_og_image: string | null
          seo_robots: string
          seo_title: string | null
          start_date: string | null
          status: Database["public"]["Enums"]["coupon_status"]
          store_id: string
          structured_terms: Json | null
          terms: string | null
          title: string
          updated_at: string
        }
        Insert: {
          affiliate_url?: string | null
          coupon_code?: string | null
          coupon_type?: Database["public"]["Enums"]["coupon_type"]
          created_at?: string
          description?: string | null
          discount_type?: string | null
          discount_value?: number | null
          expiry_date?: string | null
          featured_in_banner?: boolean
          id?: string
          imported_at?: string | null
          landing_page_url?: string | null
          metadata?: Json
          provider?: string | null
          provider_entity_id?: string | null
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["coupon_status"]
          store_id: string
          structured_terms?: Json | null
          terms?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          affiliate_url?: string | null
          coupon_code?: string | null
          coupon_type?: Database["public"]["Enums"]["coupon_type"]
          created_at?: string
          description?: string | null
          discount_type?: string | null
          discount_value?: number | null
          expiry_date?: string | null
          featured_in_banner?: boolean
          id?: string
          imported_at?: string | null
          landing_page_url?: string | null
          metadata?: Json
          provider?: string | null
          provider_entity_id?: string | null
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          start_date?: string | null
          status?: Database["public"]["Enums"]["coupon_status"]
          store_id?: string
          structured_terms?: Json | null
          terms?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coupons_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      email_templates: {
        Row: {
          body: string
          created_at: string
          id: string
          key: string
          subject: string
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          key: string
          subject: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          key?: string
          subject?: string
          updated_at?: string
        }
        Relationships: []
      }
      head_entries: {
        Row: {
          content: string | null
          created_at: string
          enabled: boolean
          id: string
          name: string
          notes: string | null
          provider: string
          section: string
          type: string
          updated_at: string
          value: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          notes?: string | null
          provider?: string
          section: string
          type?: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          name?: string
          notes?: string | null
          provider?: string
          section?: string
          type?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      menus: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string
          location: string
          sort_order: number
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label: string
          location?: string
          sort_order?: number
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string
          location?: string
          sort_order?: number
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      newsletter_logs: {
        Row: {
          coupons_sent: number
          created_at: string
          error_message: string | null
          execution_time: number
          failed: number
          id: string
          sent_at: string
          status: string
          subscribers_count: number
          successful: number
        }
        Insert: {
          coupons_sent?: number
          created_at?: string
          error_message?: string | null
          execution_time?: number
          failed?: number
          id?: string
          sent_at?: string
          status?: string
          subscribers_count?: number
          successful?: number
        }
        Update: {
          coupons_sent?: number
          created_at?: string
          error_message?: string | null
          execution_time?: number
          failed?: number
          id?: string
          sent_at?: string
          status?: string
          subscribers_count?: number
          successful?: number
        }
        Relationships: []
      }
      pages: {
        Row: {
          content: string | null
          created_at: string
          id: string
          meta_description: string | null
          meta_title: string | null
          published: boolean
          seo_canonical_url: string | null
          seo_description: string | null
          seo_og_image: string | null
          seo_robots: string
          seo_title: string | null
          slug: string
          title: string
          updated_at: string
        }
        Insert: {
          content?: string | null
          created_at?: string
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          published?: boolean
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          slug: string
          title: string
          updated_at?: string
        }
        Update: {
          content?: string | null
          created_at?: string
          id?: string
          meta_description?: string | null
          meta_title?: string | null
          published?: boolean
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          slug?: string
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      post_comments: {
        Row: {
          author_name: string | null
          body: string
          created_at: string
          id: string
          post_id: string
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          author_name?: string | null
          body: string
          created_at?: string
          id?: string
          post_id: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          author_name?: string | null
          body?: string
          created_at?: string
          id?: string
          post_id?: string
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string | null
          body: string
          category_id: string | null
          cover_image: string | null
          created_at: string
          excerpt: string | null
          id: string
          published_at: string | null
          seo_canonical_url: string | null
          seo_description: string | null
          seo_og_image: string | null
          seo_robots: string
          seo_title: string | null
          slug: string
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          author_id?: string | null
          body?: string
          category_id?: string | null
          cover_image?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published_at?: string | null
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          slug: string
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string | null
          body?: string
          category_id?: string | null
          cover_image?: string | null
          created_at?: string
          excerpt?: string | null
          id?: string
          published_at?: string | null
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          slug?: string
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "blog_categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      publishing_policies: {
        Row: {
          created_at: string
          description: string | null
          enabled: boolean
          fair_distribution: boolean
          id: string
          is_default: boolean
          max_coupons_per_store: number
          max_deals_per_store: number
          min_coupons_per_store: number
          min_deals_per_store: number
          name: string
          never_overwrite_admin_edits: boolean
          preview_before_import: boolean
          publish_only_active: boolean
          ranking_priority: string[]
          respect_manual_disable: boolean
          rotation: boolean
          skip_duplicate_identities: boolean
          skip_expired: boolean
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          fair_distribution?: boolean
          id?: string
          is_default?: boolean
          max_coupons_per_store?: number
          max_deals_per_store?: number
          min_coupons_per_store?: number
          min_deals_per_store?: number
          name: string
          never_overwrite_admin_edits?: boolean
          preview_before_import?: boolean
          publish_only_active?: boolean
          ranking_priority?: string[]
          respect_manual_disable?: boolean
          rotation?: boolean
          skip_duplicate_identities?: boolean
          skip_expired?: boolean
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          enabled?: boolean
          fair_distribution?: boolean
          id?: string
          is_default?: boolean
          max_coupons_per_store?: number
          max_deals_per_store?: number
          min_coupons_per_store?: number
          min_deals_per_store?: number
          name?: string
          never_overwrite_admin_edits?: boolean
          preview_before_import?: boolean
          publish_only_active?: boolean
          ranking_priority?: string[]
          respect_manual_disable?: boolean
          rotation?: boolean
          skip_duplicate_identities?: boolean
          skip_expired?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      publishing_rotation_state: {
        Row: {
          created_at: string
          cursor: number
          id: string
          policy_id: string
          provider: string
          store_key: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          cursor?: number
          id?: string
          policy_id: string
          provider: string
          store_key: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          cursor?: number
          id?: string
          policy_id?: string
          provider?: string
          store_key?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "publishing_rotation_state_policy_id_fkey"
            columns: ["policy_id"]
            isOneToOne: false
            referencedRelation: "publishing_policies"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_coupons: {
        Row: {
          coupon_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          coupon_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          coupon_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_coupons_coupon_id_fkey"
            columns: ["coupon_id"]
            isOneToOne: false
            referencedRelation: "coupons"
            referencedColumns: ["id"]
          },
        ]
      }
      saved_stores: {
        Row: {
          created_at: string
          store_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          store_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          store_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "saved_stores_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      search_queries: {
        Row: {
          created_at: string
          id: string
          query: string
          source: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          query: string
          source?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          query?: string
          source?: string
          user_id?: string | null
        }
        Relationships: []
      }
      site_settings: {
        Row: {
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      sliders: {
        Row: {
          active: boolean
          created_at: string
          id: string
          image_url: string | null
          link_url: string | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          image_url?: string | null
          link_url?: string | null
          sort_order?: number
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          image_url?: string | null
          link_url?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      store_reviews: {
        Row: {
          body: string | null
          created_at: string
          id: string
          rating: number
          status: string
          store_id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          rating: number
          status?: string
          store_id: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          rating?: number
          status?: string
          store_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_reviews_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          affiliate_url: string | null
          category_id: string | null
          country: string | null
          created_at: string
          description: string | null
          featured: boolean
          id: string
          import_origin: string | null
          imported_at: string | null
          last_qualification_result: string | null
          last_qualified_at: string | null
          lifecycle_hidden: boolean
          lifecycle_managed: boolean
          logo_source_url: string | null
          logo_url: string | null
          metadata: Json
          name: string
          provider: string | null
          provider_entity_id: string | null
          seo_canonical_url: string | null
          seo_description: string | null
          seo_og_image: string | null
          seo_robots: string
          seo_title: string | null
          shipping_regions: string[]
          slug: string
          updated_at: string
        }
        Insert: {
          affiliate_url?: string | null
          category_id?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          import_origin?: string | null
          imported_at?: string | null
          last_qualification_result?: string | null
          last_qualified_at?: string | null
          lifecycle_hidden?: boolean
          lifecycle_managed?: boolean
          logo_source_url?: string | null
          logo_url?: string | null
          metadata?: Json
          name: string
          provider?: string | null
          provider_entity_id?: string | null
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          shipping_regions?: string[]
          slug: string
          updated_at?: string
        }
        Update: {
          affiliate_url?: string | null
          category_id?: string | null
          country?: string | null
          created_at?: string
          description?: string | null
          featured?: boolean
          id?: string
          import_origin?: string | null
          imported_at?: string | null
          last_qualification_result?: string | null
          last_qualified_at?: string | null
          lifecycle_hidden?: boolean
          lifecycle_managed?: boolean
          logo_source_url?: string | null
          logo_url?: string | null
          metadata?: Json
          name?: string
          provider?: string | null
          provider_entity_id?: string | null
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          shipping_regions?: string[]
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stores_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      subcategories: {
        Row: {
          category_id: string
          created_at: string
          id: string
          name: string
          seo_canonical_url: string | null
          seo_description: string | null
          seo_og_image: string | null
          seo_robots: string
          seo_title: string | null
          slug: string
          updated_at: string
        }
        Insert: {
          category_id: string
          created_at?: string
          id?: string
          name: string
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          slug: string
          updated_at?: string
        }
        Update: {
          category_id?: string
          created_at?: string
          id?: string
          name?: string
          seo_canonical_url?: string | null
          seo_description?: string | null
          seo_og_image?: string | null
          seo_robots?: string
          seo_title?: string | null
          slug?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subcategories_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      subscribers: {
        Row: {
          active: boolean
          created_at: string
          email: string
          id: string
          unsubscribe_token: string
          verified: boolean
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
          id?: string
          unsubscribe_token?: string
          verified?: boolean
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
          id?: string
          unsubscribe_token?: string
          verified?: boolean
        }
        Relationships: []
      }
      translations: {
        Row: {
          created_at: string
          id: string
          key: string
          locale: string
          updated_at: string
          value: string
        }
        Insert: {
          created_at?: string
          id?: string
          key: string
          locale: string
          updated_at?: string
          value: string
        }
        Update: {
          created_at?: string
          id?: string
          key?: string
          locale?: string
          updated_at?: string
          value?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_top_ai_searches: {
        Args: { _limit?: number }
        Returns: {
          count: number
          query: string
        }[]
      }
      get_top_searches: {
        Args: { _limit?: number }
        Returns: {
          count: number
          query: string
        }[]
      }
      import_apply: { Args: { _payload: Json }; Returns: Json }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      subscribe_email: { Args: { _email: string }; Returns: undefined }
      unsubscribe_by_token: { Args: { _token: string }; Returns: boolean }
    }
    Enums: {
      app_role: "admin" | "user"
      coupon_status: "active" | "expired" | "draft"
      coupon_type: "code" | "deal"
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
      app_role: ["admin", "user"],
      coupon_status: ["active", "expired", "draft"],
      coupon_type: ["code", "deal"],
    },
  },
} as const
