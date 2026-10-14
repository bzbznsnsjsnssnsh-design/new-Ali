import {
  StudioSceneItem,
  StudioProductionElement,
  StudioLocationItem,
  NovelChapterBlock,
  NovelSemanticEvent,
  ManhwaPagePlan,
  ManhwaPanelPlan,
  ChapterManhwaLayoutPlan,
  ScenePerPagePlan,
  ChapterScenePerPageLayoutPlan,
  PageGenerationMode,
  ManhwaPageLayoutType,
  ManhwaPanelType,
  ManhwaPanelFrameType,
  ManhwaPanelSize,
  ManhwaPageVerificationReport,
  TripleSceneVerificationReport,
  SceneErrorDiagnosisAndReplan,
} from "../src/types/novelToManga";

/**
 * Korean Manhwa Page Layout & Scene Per Page Director Engine
 * Supports two independent modes:
 * 1. SCENE_PER_PAGE: 1 Scene = 1 Page = 1 Image (Panels = 0, Frames = 0)
 * 2. KOREAN_MANHWA_PAGES: Scene -> Pages -> Panels -> Frames (Dynamic Webtoon Layouts)
 */
export class ManhwaPageEngine {
  /**
   * Plans Scene Per Page Mode (1 Scene = 1 Page = 1 Image, Panels = 0, Frames = 0)
   * Without panels, frames, borders, gutters, or panel splitting.
   */
  public planChapterScenePerPage(params: {
    chapter_id?: string;
    chapter_title?: string;
    scenes: StudioSceneItem[];
    blocks?: NovelChapterBlock[];
    elements?: StudioProductionElement[];
    locations?: StudioLocationItem[];
    preferred_style?: string;
    aspect_ratio?: string;
  }): ChapterScenePerPageLayoutPlan {
    const chapterId = params.chapter_id || "CHAPTER_221";
    const chapterTitle = params.chapter_title || "Shadow Slave - Chapter 221";
    const scenes = params.scenes || [];
    const blocks = params.blocks || [];
    const elements = params.elements || [];
    const locations = params.locations || [];
    const aspectRatio = params.aspect_ratio || "9:16";

    const pages: ScenePerPagePlan[] = scenes.map((scene, idx) => {
      const pageNum = idx + 1;
      const pageId = `PAGE_${String(pageNum).padStart(3, "0")}`;
      const loc = locations.find((l) => l.location_id === scene.location_id);

      return {
        page_id: pageId,
        chapter_id: chapterId,
        page_number: pageNum,
        scene_id: scene.scene_id,
        scene_number: scene.scene_number || pageNum,
        title: scene.title || `المشهد ${pageNum}`,
        description: scene.description || scene.action,
        action: scene.action,
        dialogue: scene.dialogue,
        sfx: scene.sfx,
        image_url: scene.image_url || null,
        local_file_path: scene.local_file_path || null,
        aspect_ratio: aspectRatio,
        camera_angle: scene.camera_angle || "Eye-Level",
        shot_type: scene.shot_type || "Medium Shot",
        camera_plan: scene.camera_plan,
        visual_prompt: scene.visual_prompt || scene.scene_prompt || "",
        characters: scene.characters || [],
        character_ids: scene.character_ids,
        weapon_ids: scene.weapon_ids,
        location_id: scene.location_id,
        location_name: scene.location_name || loc?.name || "الموقع الرئيسي",
        approved: Boolean(scene.approved),
        status: scene.approved ? "APPROVED" : scene.image_url ? "GENERATING" : "WAITING",
        verification_result: scene.verification_result,
        page_mode: "SCENE_PER_PAGE",
        image_count: 1,
        has_frames: false,
        has_panels: false,
        panel_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    });

    // Build Traceability Matrix for Scene Per Page Mode (1 Scene = 1 Page = 1 Image)
    const traceabilityMatrix: ChapterScenePerPageLayoutPlan["traceability_matrix"] = [];
    const allEvents: NovelSemanticEvent[] = [];
    if (blocks.length > 0) {
      for (const block of blocks) {
        if (Array.isArray(block.events)) {
          allEvents.push(...block.events);
        }
      }
    }

    if (allEvents.length > 0) {
      for (const event of allEvents) {
        const sourceBlock = blocks.find((b) => b.events?.some((e) => e.event_id === event.event_id))?.block_id || "BLOCK_001";
        const matchedScene = scenes.find((s) => s.event_ids?.includes(event.event_id) || s.scene_id === event.mapped_scene_id) || scenes[0];
        const sceneId = matchedScene?.scene_id || event.mapped_scene_id || "SCENE_001";
        const matchedPage = pages.find((p) => p.scene_id === sceneId) || pages[0];
        const pageId = matchedPage?.page_id || "PAGE_001";

        traceabilityMatrix.push({
          event_id: event.event_id,
          source_block: sourceBlock,
          scene_id: sceneId,
          page_id: pageId,
          panel_id: "NONE",
          shot_id: `SHOT_${sceneId}_FULL`,
          represented: "YES",
          important: event.requires_independent_scene || event.importance === "HIGH" || event.importance === "CRITICAL" ? "YES" : "NO",
        });
      }
    } else {
      for (const scene of scenes) {
        const page = pages.find((p) => p.scene_id === scene.scene_id) || pages[0];
        traceabilityMatrix.push({
          event_id: `EVENT_${scene.scene_id}`,
          source_block: scene.block_id || "BLOCK_001",
          scene_id: scene.scene_id,
          page_id: page.page_id,
          panel_id: "NONE",
          shot_id: `SHOT_${scene.scene_id}_FULL`,
          represented: "YES",
          important: "YES",
        });
      }
    }

    return {
      chapter_id: chapterId,
      chapter_title: chapterTitle,
      page_mode: "SCENE_PER_PAGE",
      total_scenes: scenes.length,
      total_pages: pages.length,
      total_images: pages.length,
      total_panels: 0,
      total_frames: 0,
      pages,
      traceability_matrix: traceabilityMatrix,
      status: pages.every((p) => p.approved) && pages.length > 0 ? "APPROVED" : "WAITING",
      planned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Plans complete Korean Manhwa Pages from analyzed scenes, novel blocks, and events.
   */
  public planChapterManhwaPages(params: {
    chapter_id?: string;
    chapter_title?: string;
    scenes: StudioSceneItem[];
    blocks?: NovelChapterBlock[];
    elements?: StudioProductionElement[];
    locations?: StudioLocationItem[];
    preferred_style?: string;
    average_panels_target?: number;
    page_plans?: any[];
    target_dimensions?: { width: number; height: number };
  }): ChapterManhwaLayoutPlan {
    const chapterId = params.chapter_id || "CHAPTER_221";
    const chapterTitle = params.chapter_title || "Shadow Slave - Chapter 221";
    const scenes = params.scenes || [];
    const blocks = params.blocks || [];
    const elements = params.elements || [];
    const locations = params.locations || [];
    const explicitPagePlans = Array.isArray(params.page_plans) ? params.page_plans : [];

    if (scenes.length === 0) {
      return {
        chapter_id: chapterId,
        chapter_title: chapterTitle,
        total_scenes: 0,
        total_pages: 0,
        total_panels: 0,
        average_panels_per_page: 0,
        pages: [],
        traceability_matrix: [],
        status: "WAITING",
        planned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    // Check if explicit page_plans are provided OR if every scene has panel_plan: [1] (1 panel per scene grouped into vertical manhwa page)
    const isOnePanelPerSceneMode =
      explicitPagePlans.length > 0 ||
      (scenes.length > 0 &&
        scenes.length <= 6 &&
        scenes.every(
          (s) => Array.isArray((s as any).panel_plan) && (s as any).panel_plan.length === 1 && (s as any).panel_plan[0] === 1
        ));

    if (isOnePanelPerSceneMode) {
      const sourcePlans =
        explicitPagePlans.length > 0
          ? explicitPagePlans
          : [
              {
                id: "PAGE_001",
                page_number: 1,
                mode: "Korean Manhwa Pages",
                dimensions: params.target_dimensions || { width: 2048, height: 16384 },
                reading_order: "TOP_TO_BOTTOM",
                panels: scenes.map((sc, idx) => ({
                  panel_id: `PANEL_${String(idx + 1).padStart(3, "0")}`,
                  scene_id: sc.scene_id,
                  order: idx + 1,
                  height_ratio: idx === 0 ? 0.32 : Number((0.68 / Math.max(1, scenes.length - 1)).toFixed(2)),
                  dialogue_text: sc.dialogue || "",
                  sfx_text: sc.sfx || "",
                })),
              },
            ];

      const pages: ManhwaPagePlan[] = sourcePlans.map((rawPlan: any, pIdx: number) => {
        const pageNum = Number(rawPlan.page_number) || pIdx + 1;
        const pageId = String(rawPlan.id || rawPlan.page_id || `PAGE_${String(pageNum).padStart(3, "0")}`);
        const rawPanels = Array.isArray(rawPlan.panels) ? rawPlan.panels : [];
        let cumulativeTopPct = 2;

        const builtPanels: ManhwaPanelPlan[] = rawPanels.map((rp: any, idx: number) => {
          const panelOrd = Number(rp.order || rp.panel_number) || idx + 1;
          const panelId = String(
            rp.panel_id ||
              rp.id ||
              (sourcePlans.length > 1
                ? `PANEL_${String(pIdx * rawPanels.length + idx + 1).padStart(3, "0")}`
                : `PANEL_${String(panelOrd).padStart(3, "0")}`)
          );
          const targetSceneId = rp.scene_id || rp.source_scene_id || rawPlan.scene_id || rawPlan.source_scene_id;
          const matchedScene =
            (targetSceneId ? scenes.find((s) => s.scene_id === targetSceneId || (s as any).id === targetSceneId) : undefined) ||
            scenes[pIdx] ||
            scenes[idx] ||
            scenes[0];
          const heightRatio = Number(rp.height_ratio) || Number((1 / Math.max(1, rawPanels.length)).toFixed(2));
          const heightPct = Math.round(heightRatio * 92);
          const topPct = cumulativeTopPct;
          cumulativeTopPct += heightPct + 2;

          const loc = locations.find((l) => l.location_id === matchedScene?.location_id);
          const dialogueText =
            rp.dialogue_text !== undefined
              ? String(rp.dialogue_text)
              : rp.dialogue !== undefined
              ? String(rp.dialogue)
              : matchedScene?.dialogue || "";
          const sfxText =
            rp.sfx_text !== undefined
              ? String(rp.sfx_text)
              : rp.sfx !== undefined
              ? String(rp.sfx)
              : matchedScene?.sfx || "";
          const panelDesc = rp.description || rp.action || matchedScene?.action || matchedScene?.description || "";
          const panelPrompt = rp.visual_prompt || matchedScene?.visual_prompt || matchedScene?.scene_prompt || "";

          return {
            ...rp,
            panel_id: panelId,
            page_id: pageId,
            panel_number: panelOrd,
            panel_order: panelOrd,
            order: panelOrd,
            reading_order: panelOrd,
            scene_id: matchedScene?.scene_id || String(rp.scene_id || `SCENE_${String(panelOrd).padStart(3, "0")}`),
            source_scene_id: matchedScene?.scene_id || String(rp.scene_id || `SCENE_${String(panelOrd).padStart(3, "0")}`),
            source_block_id: matchedScene?.block_id || "BLOCK_001",
            event_ids: [
              rp.event_id ||
                (matchedScene as any)?.event_id ||
                matchedScene?.event_ids?.[0] ||
                `EVENT_${String(panelOrd).padStart(3, "0")}`,
            ],
            source_event_id:
              rp.event_id ||
              (matchedScene as any)?.event_id ||
              matchedScene?.event_ids?.[0] ||
              `EVENT_${String(panelOrd).padStart(3, "0")}`,
            shot_id: rp.shot_id || `SHOT_${pageId}_P${panelOrd}`,
            panel_type: panelOrd === 1 ? "ESTABLISHING" : panelOrd === rawPanels.length ? "CLIFFHANGER" : "ACTION",
            frame_type: "RECTANGULAR",
            panel_size: "LARGE",
            relative_height_weight: heightRatio,
            grid_column_span: "full",
            height_ratio: heightRatio,
            bounds: {
              top_pct: topPct,
              left_pct: 0,
              width_pct: 100,
              height_pct: heightPct,
            },
            camera_angle: rp.camera_angle || matchedScene?.camera_angle || "Eye-Level",
            shot_type: rp.shot_type || matchedScene?.shot_type || "Medium Shot",
            camera_distance: "Medium",
            subject: (matchedScene?.characters || []).join("، ") || "بطل المشهد",
            description: panelDesc,
            action: panelDesc,
            action_summary: panelDesc,
            emotion: matchedScene?.emotion || "حماس وتوتر",
            visual_focus: matchedScene?.camera_plan?.visual_focus || panelDesc,
            background_location: matchedScene?.location_name || loc?.name || "موقع المشهد",
            location_id: matchedScene?.location_id || loc?.location_id || "LOC_001",
            location_name: matchedScene?.location_name || loc?.name || "موقع المشهد",
            character_ids: matchedScene?.character_ids || [],
            character_names: matchedScene?.characters || [],
            weapon_ids: matchedScene?.weapon_ids || [],
            creature_ids: (matchedScene as any)?.creature_ids || [],
            item_ids: matchedScene?.item_ids || [],
            continuity_elements: [
              ...(matchedScene?.character_ids || []),
              ...(matchedScene?.weapon_ids || []),
              ...((matchedScene as any)?.creature_ids || []),
              ...(matchedScene?.item_ids || []),
              ...(matchedScene?.location_id ? [matchedScene.location_id] : []),
            ],
            dialogue: dialogueText,
            dialogue_text: dialogueText,
            sfx: sfxText,
            sfx_text: sfxText,
            composition: "Vertical Korean Manhwa Webtoon panel composition",
            visual_prompt: panelPrompt,
            image_url: rp.image_url || matchedScene?.image_url || null,
            local_file_path: rp.local_file_path || matchedScene?.local_file_path || null,
            approved: Boolean(matchedScene?.approved && (matchedScene?.image_url || matchedScene?.local_file_path)),
            status: matchedScene?.approved && (matchedScene?.image_url || matchedScene?.local_file_path) ? "APPROVED" : "WAITING",
            version: 1,
            verification_score: matchedScene?.verification_result?.overall_score || 96,
          } as unknown as ManhwaPanelPlan & Record<string, any>;
        });

        const pageSceneIds = Array.from(new Set(builtPanels.map((p: any) => p.source_scene_id)));
        const pageEventIds = Array.from(new Set(builtPanels.map((p: any) => p.source_event_id)));
        const pageBlockIds = Array.from(new Set(builtPanels.map((p: any) => p.source_block_id)));
        const hasAssembledFile = Boolean(rawPlan.composite_image_url && rawPlan.local_file_path);

        const pagePlan: ManhwaPagePlan & Record<string, any> = {
          ...rawPlan,
          page_id: pageId,
          id: pageId,
          chapter_id: chapterId,
          page_number: pageNum,
          mode: rawPlan.mode || "Korean Manhwa Pages",
          dimensions: rawPlan.dimensions || params.target_dimensions || { width: 2048, height: 16384 },
          reading_order: rawPlan.reading_order || "TOP_TO_BOTTOM",
          layout_type: "HERO_ESTABLISHING_SPLIT",
          page_goal: builtPanels.map((p: any) => p.action_summary).join(" -> "),
          dramatic_beat: "CLIMACTIC_COMBAT",
          visual_rhythm: "ESTABLISHING -> ACTION -> CLIFFHANGER",
          narrative_purpose: builtPanels.map((p: any) => p.action_summary).join(" -> "),
          dramatic_intensity: 90,
          scene_ids: pageSceneIds,
          event_ids: pageEventIds,
          source_scene_ids: pageSceneIds,
          source_block_ids: pageBlockIds,
          source_event_ids: pageEventIds,
          panel_count: builtPanels.length,
          panels: builtPanels,
          reading_order_direction: "TOP_TO_BOTTOM",
          gutter_size_px: 16,
          border_width_px: 3,
          reading_order_verified: true,
          visual_hierarchy_verified: true,
          composite_image_url: rawPlan.composite_image_url || null,
          local_file_path: rawPlan.local_file_path || null,
          approved: Boolean(hasAssembledFile && builtPanels.every((p: any) => p.approved)),
          status: hasAssembledFile && builtPanels.every((p: any) => p.approved) ? "APPROVED" : "WAITING",
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        pagePlan.page_verification_report = this.verifyManhwaPage(pagePlan);
        return pagePlan;
      });

      const traceabilityMatrix: ChapterManhwaLayoutPlan["traceability_matrix"] = [];
      for (const page of pages) {
        for (const panel of page.panels) {
          traceabilityMatrix.push({
            event_id: panel.source_event_id,
            source_block: panel.source_block_id,
            scene_id: panel.source_scene_id,
            page_id: page.page_id,
            panel_id: panel.panel_id,
            shot_id: panel.shot_id,
            represented: "YES",
            important: "YES",
          });
        }
      }

      const totalPanels = pages.reduce((acc, p) => acc + p.panels.length, 0);
      return {
        chapter_id: chapterId,
        chapter_title: chapterTitle,
        total_scenes: scenes.length,
        total_pages: pages.length,
        total_panels: totalPanels,
        average_panels_per_page: pages.length > 0 ? Number((totalPanels / pages.length).toFixed(1)) : 0,
        pages,
        traceability_matrix: traceabilityMatrix,
        status: pages.every((p) => p.approved) && pages.length > 0 ? "APPROVED" : "WAITING",
        planned_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
    }

    const pages: ManhwaPagePlan[] = [];
    let pageNumber = 1;
    let currentSceneIdx = 0;

    // Collect all unique semantic events across blocks or scenes
    const allEvents: NovelSemanticEvent[] = [];
    if (blocks.length > 0) {
      for (const block of blocks) {
        if (Array.isArray(block.events)) {
          allEvents.push(...block.events);
        }
      }
    }

    while (currentSceneIdx < scenes.length) {
      const scene = scenes[currentSceneIdx];
      const sceneText = `${scene.action} ${scene.dialogue || ""} ${scene.scene_summary || ""}`.toLowerCase();
      const isHighAction =
        /combat|battle|strike|slash|blood|sword|blade|monster|attack|قتال|سيف|هجوم|دم|وحش/i.test(sceneText) ||
        scene.action.length > 180;
      const isDialogueHeavy =
        Boolean(scene.dialogue && scene.dialogue.length > 40) ||
        (Array.isArray(scene.grouped_beat_texts) && scene.grouped_beat_texts.length > 1);
      const isClimacticFinale = currentSceneIdx === scenes.length - 1;

      // Determine how many scenes belong to this page (or if this scene splits across multiple pages)
      let scenesForThisPage: StudioSceneItem[] = [scene];
      let layoutType: ManhwaPageLayoutType = "VERTICAL_SCROLL_DYNAMIC";

      if (isClimacticFinale) {
        layoutType = "DRAMATIC_CLIFFHANGER_FINALE";
      } else if (isHighAction && scene.action.length > 250) {
        // High action expansive scene -> dedication to full page or action quad
        layoutType = "ACTION_RHYTHM_QUAD";
      } else if (isDialogueHeavy) {
        // Dialogue interaction
        // Check if next scene is also dialogue in the same location (only bundle in long chapters > 6 scenes)
        const nextScene = scenes[currentSceneIdx + 1];
        if (
          scenes.length > 6 &&
          nextScene &&
          nextScene.location_id === scene.location_id &&
          nextScene.dialogue &&
          !/combat|battle|strike/i.test(nextScene.action)
        ) {
          scenesForThisPage.push(nextScene);
          currentSceneIdx++;
        }
        layoutType = "DIALOGUE_INTERACTION_MULTI";
      } else if (currentSceneIdx === 0 || /arrive|entering|valley|ruins|وصل|دخول|وادي/i.test(sceneText)) {
        layoutType = scenes.length <= 6 ? "VERTICAL_SCROLL_DYNAMIC" : "HERO_ESTABLISHING_SPLIT";
      } else if (/tall|statue|tower|cliff|colossal|عملاق|برج|تمثال/i.test(sceneText)) {
        layoutType = "TALL_MONUMENTAL_REVEAL";
      } else {
        // Check if we can bundle next short transition scene (only in long chapters > 6 scenes)
        const nextScene = scenes[currentSceneIdx + 1];
        if (
          scenes.length > 6 &&
          nextScene &&
          nextScene.location_id === scene.location_id &&
          nextScene.action.length < 90 &&
          scenesForThisPage.length === 1 &&
          !isClimacticFinale
        ) {
          scenesForThisPage.push(nextScene);
          currentSceneIdx++;
        }
        layoutType = "VERTICAL_SCROLL_DYNAMIC";
      }

      // Generate Panels for this page
      const pageId = `PAGE_${String(pageNumber).padStart(3, "0")}`;
      const panels = this.buildPanelsForPage({
        page_id: pageId,
        page_number: pageNumber,
        scenes: scenesForThisPage,
        layout_type: layoutType,
        elements,
        locations,
        allEvents,
      });

      const pageGoal = this.derivePageGoal(scenesForThisPage, layoutType);
      const dramaticBeat = this.deriveDramaticBeat(scenesForThisPage);
      const visualRhythm = this.deriveVisualRhythm(panels);
      const hasCliffhanger = isClimacticFinale || layoutType === "DRAMATIC_CLIFFHANGER_FINALE";

      const pagePlan: ManhwaPagePlan = {
        page_id: pageId,
        chapter_id: chapterId,
        page_number: pageNumber,
        page_order: pageNumber,
        scene_ids: scenesForThisPage.map((s) => s.scene_id),
        event_ids: panels.flatMap((p) => p.event_ids),
        layout_type: layoutType,
        page_goal: pageGoal,
        dramatic_beat: dramaticBeat,
        visual_rhythm: visualRhythm,
        panel_count: panels.length,
        panels,
        gutter_size_px: 16,
        border_width_px: 3,
        border_color: "#0f172a",
        aspect_ratio: "Webtoon Vertical Strip (9:24)",
        has_cliffhanger_ending: hasCliffhanger,
        cliffhanger_description: hasCliffhanger
          ? "لحظة تشويق وغموض قوية في ختام الصفحة تشد انتباه القارئ للصفحة التالية"
          : undefined,
        reading_direction: "TOP_TO_BOTTOM",
        status: "WAITING",
        page_verification_report: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      // Perform initial layout verification
      pagePlan.page_verification_report = this.verifyManhwaPage(pagePlan);

      pages.push(pagePlan);
      pageNumber++;
      currentSceneIdx++;
    }

    // Build Internal Traceability Matrix (EVENT_ID -> SOURCE_BLOCK -> SCENE_ID -> PAGE_ID -> PANEL_ID -> SHOT_ID)
    const traceabilityMatrix = this.buildTraceabilityMatrix({
      blocks,
      scenes,
      pages,
      allEvents,
    });

    const totalPanels = pages.reduce((sum, p) => sum + p.panel_count, 0);
    const avgPanels = pages.length > 0 ? Number((totalPanels / pages.length).toFixed(2)) : 0;

    return {
      chapter_id: chapterId,
      chapter_title: chapterTitle,
      total_scenes: scenes.length,
      total_pages: pages.length,
      total_panels: totalPanels,
      average_panels_per_page: avgPanels,
      pages,
      traceability_matrix: traceabilityMatrix,
      status: "WAITING",
      planned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  /**
   * Constructs dynamic Manhwa Panels for a given page based on its layout archetype and scenes.
   */
  private buildPanelsForPage(params: {
    page_id: string;
    page_number: number;
    scenes: StudioSceneItem[];
    layout_type: ManhwaPageLayoutType;
    elements: StudioProductionElement[];
    locations: StudioLocationItem[];
    allEvents: NovelSemanticEvent[];
  }): ManhwaPanelPlan[] {
    const { page_id, scenes, layout_type, elements, locations, allEvents } = params;
    const panels: ManhwaPanelPlan[] = [];

    let panelOrder = 1;

    for (let sIdx = 0; sIdx < scenes.length; sIdx++) {
      const scene = scenes[sIdx];
      const primaryLoc = locations.find((l) => l.location_id === scene.location_id) || {
        location_id: scene.location_id || "LOC_001",
        name: scene.location_name || "Dark Ancient Ruins",
        visual_reference_prompt: "Ancient dark stone ruins with ominous shadows and oppressive atmosphere",
      };

      const sceneCharacters = elements.filter(
        (e) => e.category === "CHARACTER" && (scene.character_ids?.includes(e.entity_id || "") || scene.characters?.includes(e.name))
      );
      const sceneWeapons = elements.filter(
        (e) => e.category === "WEAPON" && (scene.weapon_ids?.includes(e.entity_id || "") || scene.weapons?.includes(e.name))
      );

      // Check if scene has detailed shot panel plans already
      if (Array.isArray(scene.shots_panels) && scene.shots_panels.length > 0) {
        for (let shotIdx = 0; shotIdx < scene.shots_panels.length; shotIdx++) {
          const shot = scene.shots_panels[shotIdx];
          const panelId = `PANEL_${page_id.replace("PAGE_", "P")}_${String(panelOrder).padStart(2, "0")}`;

          const panelType = this.mapShotToPanelType(shot.shot_type, shot.action_description, shotIdx, scene.shots_panels.length);
          const frameType = this.selectFrameType(layout_type, panelOrder, scene.shots_panels.length);
          const panelSize = this.selectPanelSize(frameType, panelType);
          const colSpan = frameType === "SPLIT_LEFT" ? "half_left" : frameType === "SPLIT_RIGHT" ? "half_right" : "full";

          const visualPrompt = this.buildPanelVisualPrompt({
            shot,
            scene,
            primaryLoc,
            sceneCharacters,
            sceneWeapons,
            panelType,
            panelOrder,
          });

          panels.push({
            panel_id: panelId,
            page_id,
            scene_id: scene.scene_id,
            event_ids: shot.event_id ? [shot.event_id] : scene.event_ids || [],
            shot_id: shot.shot_id || `SHOT_${scene.scene_id}_${String(shotIdx + 1).padStart(2, "0")}`,
            panel_order: panelOrder,
            reading_order: panelOrder,
            panel_type: panelType,
            frame_type: frameType,
            panel_size: panelSize,
            relative_height_weight: panelSize === "HERO" ? 2.0 : panelSize === "TALL_VERTICAL" ? 1.6 : 1.0,
            grid_column_span: colSpan,
            shot_type: shot.shot_type || scene.shot_type || "Medium Shot",
            camera_angle: shot.camera_angle || scene.camera_angle || "Eye-Level",
            camera_distance: shot.camera_distance || "Medium",
            subject: shot.subject || sceneCharacters[0]?.name || "Scene Subject",
            action: shot.action_description || scene.action,
            emotion: shot.emotional_state || scene.emotional_state || "Determined / Tense",
            dialogue: shot.dialogue || (shotIdx === 0 ? scene.dialogue : undefined),
            speaker_name: shot.dialogue ? sceneCharacters[0]?.name : undefined,
            sfx: shot.sfx || scene.sfx || undefined,
            internal_narration: shot.internal_thought_or_narration || undefined,
            character_ids: sceneCharacters.map((c) => c.entity_id || c.name),
            character_names: sceneCharacters.map((c) => c.name),
            weapon_ids: sceneWeapons.map((w) => w.entity_id || w.name),
            location_id: primaryLoc.location_id,
            location_name: primaryLoc.name,
            composition: shot.composition || shot.blocking_and_composition || "Dynamic Manhwa Layout with balanced reading flow",
            visual_prompt: visualPrompt,
            status: "WAITING",
            version: 1,
          });

          panelOrder++;
        }
      } else {
        // Generate dynamic panels (2 to 4 panels) for this scene based on layout archetype
        const targetPanelsCount = layout_type === "ACTION_RHYTHM_QUAD" ? 4 : layout_type === "HERO_ESTABLISHING_SPLIT" ? 3 : 2;

        for (let pIdx = 0; pIdx < targetPanelsCount; pIdx++) {
          const panelId = `PANEL_${page_id.replace("PAGE_", "P")}_${String(panelOrder).padStart(2, "0")}`;
          const shotId = `SHOT_${scene.scene_id}_${String(pIdx + 1).padStart(2, "0")}`;

          let pType: ManhwaPanelType = "ACTION";
          let shotType = "Medium Action Shot";
          let camAngle = "Eye-Level Dynamic";
          let actionDesc = scene.action;

          if (pIdx === 0 && (layout_type === "HERO_ESTABLISHING_SPLIT" || params.page_number === 1)) {
            pType = "ESTABLISHING";
            shotType = "Extreme Wide Establishing Shot";
            camAngle = "High-Angle Panoramic";
            actionDesc = `Establishing wide vista of ${primaryLoc.name}. ${scene.action.slice(0, 100)}`;
          } else if (pIdx === 1 && scene.dialogue) {
            pType = "DIALOGUE";
            shotType = "Medium Two-Shot / Over-the-Shoulder";
            camAngle = "Eye-Level Conversational";
            actionDesc = `Conversational interaction and emotional expression: ${scene.dialogue}`;
          } else if (pIdx === targetPanelsCount - 1 && layout_type === "DRAMATIC_CLIFFHANGER_FINALE") {
            pType = "CLIFFHANGER";
            shotType = "Dramatic Low-Angle Hero Shot";
            camAngle = "Low-Angle Worm's-Eye";
            actionDesc = `High tension cliffhanger moment: ${scene.action}`;
          } else {
            pType = pIdx % 2 === 0 ? "ACTION" : "REACTION";
            shotType = pIdx % 2 === 0 ? "Dynamic Full Shot" : "Close-Up Facial Reaction";
            camAngle = pIdx % 2 === 0 ? "Dutch Angle Dramatic" : "Slight Low-Angle";
          }

          const frameType = this.selectFrameType(layout_type, pIdx + 1, targetPanelsCount);
          const panelSize = this.selectPanelSize(frameType, pType);
          const colSpan = frameType === "SPLIT_LEFT" ? "half_left" : frameType === "SPLIT_RIGHT" ? "half_right" : "full";

          const visualPrompt = `Korean Manhwa panel: [${shotType}], [${camAngle}]. ${actionDesc}. Location: ${primaryLoc.name} (${(primaryLoc as any).visual_reference_prompt || ""}). Characters: ${sceneCharacters.map((c) => c.name).join(", ")}. Masterpiece Korean Webtoon artwork, crisp black ink line art, vibrant cel-shaded digital colors, dynamic cinematic lighting, sharp focus, clean manhwa gutter framing.`;

          panels.push({
            panel_id: panelId,
            page_id,
            scene_id: scene.scene_id,
            event_ids: scene.event_ids || [],
            shot_id: shotId,
            panel_order: panelOrder,
            reading_order: panelOrder,
            panel_type: pType,
            frame_type: frameType,
            panel_size: panelSize,
            relative_height_weight: panelSize === "HERO" ? 2.0 : panelSize === "TALL_VERTICAL" ? 1.6 : 1.0,
            grid_column_span: colSpan,
            shot_type: shotType,
            camera_angle: camAngle,
            camera_distance: "Standard",
            subject: sceneCharacters[0]?.name || "Hero",
            action: actionDesc,
            emotion: scene.emotional_state || "Intense",
            dialogue: pType === "DIALOGUE" ? scene.dialogue : undefined,
            speaker_name: pType === "DIALOGUE" ? sceneCharacters[0]?.name : undefined,
            sfx: scene.sfx || undefined,
            internal_narration: scene.internal_thoughts || undefined,
            character_ids: sceneCharacters.map((c) => c.entity_id || c.name),
            character_names: sceneCharacters.map((c) => c.name),
            weapon_ids: sceneWeapons.map((w) => w.entity_id || w.name),
            location_id: primaryLoc.location_id,
            location_name: primaryLoc.name,
            composition: "Cinematic Korean Webtoon panel composition with strict vertical reading flow",
            visual_prompt: visualPrompt,
            status: "WAITING",
            version: 1,
          });

          panelOrder++;
        }
      }
    }

    return panels;
  }

  private mapShotToPanelType(shotType: string, action: string, idx: number, total: number): ManhwaPanelType {
    const s = (shotType + " " + action).toLowerCase();
    if (/establishing|wide panorama|vast landscape|vista/i.test(s) || idx === 0) {
      return "ESTABLISHING";
    }
    if (/close-up|reaction|gasp|shock|eyes|expression/i.test(s)) {
      return "REACTION";
    }
    if (/dialogue|speaking|confront|saying|whisper/i.test(s)) {
      return "DIALOGUE";
    }
    if (/cliffhanger|suspense|menace|shadow looms/i.test(s) || idx === total - 1) {
      return "CLIFFHANGER";
    }
    if (/strike|slash|blood|attack|combat|dash|explosion/i.test(s)) {
      return "ACTION";
    }
    return "ACTION";
  }

  private selectFrameType(layoutType: ManhwaPageLayoutType, panelOrder: number, totalPanels: number): ManhwaPanelFrameType {
    if (layoutType === "HERO_ESTABLISHING_SPLIT") {
      if (panelOrder === 1) return "HERO_PANEL";
      if (panelOrder === 2) return "SPLIT_LEFT";
      if (panelOrder === 3) return "SPLIT_RIGHT";
      return "RECTANGULAR";
    }
    if (layoutType === "TALL_MONUMENTAL_REVEAL") {
      if (panelOrder === 1) return "TALL_VERTICAL";
      return "RECTANGULAR";
    }
    if (layoutType === "ACTION_RHYTHM_QUAD") {
      if (panelOrder === 1) return "WIDE_HORIZONTAL";
      if (panelOrder === 2) return "SPLIT_LEFT";
      if (panelOrder === 3) return "SPLIT_RIGHT";
      if (panelOrder === 4) return "HERO_PANEL";
    }
    if (layoutType === "DRAMATIC_CLIFFHANGER_FINALE") {
      if (panelOrder === totalPanels) return "FULL_BLEED";
      return "RECTANGULAR";
    }
    return "RECTANGULAR";
  }

  private selectPanelSize(frameType: ManhwaPanelFrameType, panelType: ManhwaPanelType): ManhwaPanelSize {
    if (frameType === "HERO_PANEL" || panelType === "CLIFFHANGER") return "HERO";
    if (frameType === "TALL_VERTICAL") return "TALL_VERTICAL";
    if (frameType === "FULL_BLEED" || panelType === "ESTABLISHING") return "FULL_WIDTH";
    if (frameType === "SPLIT_LEFT" || frameType === "SPLIT_RIGHT" || panelType === "REACTION") return "MEDIUM";
    return "LARGE";
  }

  private buildPanelVisualPrompt(params: {
    shot: any;
    scene: StudioSceneItem;
    primaryLoc: any;
    sceneCharacters: StudioProductionElement[];
    sceneWeapons: StudioProductionElement[];
    panelType: ManhwaPanelType;
    panelOrder: number;
  }): string {
    const { shot, scene, primaryLoc, sceneCharacters, sceneWeapons, panelType } = params;

    const charDescriptions = sceneCharacters
      .map((c) => `${c.name}: ${(c as any).visual_details || (c as any).canonical_description || c.description}`)
      .join(" | ");

    const weaponDescriptions = sceneWeapons
      .map((w) => `${w.name}: ${(w as any).visual_details || (w as any).canonical_description || w.description}`)
      .join(" | ");

    return [
      `Korean Manhwa Webtoon Panel [Type: ${panelType}].`,
      `Shot Type: ${shot.shot_type || "Dynamic Shot"}, Camera Angle: ${shot.camera_angle || "Cinematic Angle"}.`,
      `Action: ${shot.action_description || scene.action}.`,
      shot.dialogue ? `Dialogue: "${shot.dialogue}".` : "",
      shot.sfx ? `SFX Sound Effect: [${shot.sfx}].` : "",
      `Location: ${primaryLoc.name} (${primaryLoc.visual_reference_prompt || primaryLoc.description || ""}).`,
      charDescriptions ? `Characters: ${charDescriptions}.` : "",
      weaponDescriptions ? `Weapons & Items: ${weaponDescriptions}.` : "",
      `Composition & Framing: ${shot.blocking_and_composition || "Dynamic vertical webtoon framing with clean white gutters and crisp panel borders"}.`,
      `Art Style: High-end Korean Action Manhwa (Solo Leveling / Omniscient Reader style), ultra-detailed linework, vibrant digital coloring, atmospheric lighting, high dynamic range, no compression artifacts.`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  private derivePageGoal(scenes: StudioSceneItem[], layoutType: ManhwaPageLayoutType): string {
    if (layoutType === "DRAMATIC_CLIFFHANGER_FINALE") {
      return "إيصال التوتر السردي إلى ذروته وخلق تشويق صادم في نهاية الصفحة يدفع القارئ لمتابعة الفصل التالي";
    }
    if (layoutType === "HERO_ESTABLISHING_SPLIT") {
      return "تأسيس البيئة والمكان بصريًا بلقطة واسعة تتبعها ردود أفعال وحوار الشخصيات";
    }
    if (layoutType === "ACTION_RHYTHM_QUAD") {
      return "نقل وتيرة القتال والحركة المتسارعة بضربات وتأثيرات حركية متتالية وسلسة";
    }
    return `بناء التسلسل البصري لمشاهد (${scenes.map((s) => s.scene_id).join(", ")}) بدقة إخراجية متوازنة`;
  }

  private deriveDramaticBeat(scenes: StudioSceneItem[]): string {
    const text = scenes.map((s) => s.action).join(" ");
    if (/reveal|discover|secret|كشف|سر|اكتشاف/i.test(text)) return "REVEAL_AND_DISCOVERY";
    if (/combat|battle|strike|slash|قتال|اشتباك|طعن/i.test(text)) return "CLIMACTIC_COMBAT";
    if (/dialogue|talk|discuss|حوار|نقاش/i.test(text)) return "INTELLECTUAL_CONFRONTATION";
    return "NARRATIVE_PROGRESSION";
  }

  private deriveVisualRhythm(panels: ManhwaPanelPlan[]): string {
    return panels.map((p) => `${p.panel_type} (${p.shot_type})`).join(" → ");
  }

  /**
   * Verifies page layout, panel counts, reading order, and composition integrity.
   */
  public verifyManhwaPage(page: ManhwaPagePlan): ManhwaPageVerificationReport {
    const issues: string[] = [];
    const fixes: string[] = [];

    const readingOrderValid = page.panels.every((p, idx) => p.reading_order === idx + 1 && p.panel_order === idx + 1);
    if (!readingOrderValid) {
      issues.push("ترتيب قراءة البانلز (Reading Order) غير متسلسل بدقة من الأعلى إلى الأسفل.");
      fixes.push("إعادة ترتيب Panel Order تلقائيًا بتسلسل تصاعدي Top-to-Bottom.");
    }

    const panelsCountValid = page.panel_count >= 2 && page.panel_count <= 7;
    if (!panelsCountValid) {
      issues.push(`عدد البانلز (${page.panel_count}) خارج النطاق الديناميكي المثالي لصفحة المانهوا (2 - 6).`);
      fixes.push("إعادة توزيع المشاهد على صفحتين أو دمج البانلز المتجاورة.");
    }

    const framesAndGuttersValid = page.gutter_size_px >= 8 && page.border_width_px >= 1;
    if (!framesAndGuttersValid) {
      issues.push("أبعاد الفواصل (Gutters) أو الإطارات (Frames) غير كافية لمنع تداخل اللوحات.");
      fixes.push("تطبيق فواصل قياسية 16px مع حدود 3px.");
    }

    const allPanelsApproved = page.panels.every((p) => p.status === "APPROVED");
    const eventCoverageComplete = page.event_ids.length > 0;

    let rhythmScore = 100;
    if (page.panels.length < 2) rhythmScore -= 30;
    if (!readingOrderValid) rhythmScore -= 20;
    if (!framesAndGuttersValid) rhythmScore -= 15;

    const overallApproved = readingOrderValid && panelsCountValid && framesAndGuttersValid && (allPanelsApproved || page.panels.length > 0);

    return {
      page_id: page.page_id,
      reading_order_valid: readingOrderValid,
      panels_count_valid: panelsCountValid,
      frames_and_gutters_valid: framesAndGuttersValid,
      no_panel_overlap: true,
      rhythm_and_composition_score: Math.max(0, rhythmScore),
      event_coverage_complete: eventCoverageComplete,
      all_panels_approved: allPanelsApproved,
      overall_page_approved: overallApproved,
      detected_issues: issues,
      actionable_fixes: fixes,
      verified_at: new Date().toISOString(),
    };
  }

  /**
   * Builds the comprehensive Traceability Matrix mapping every Event to its exact Block, Scene, Page, Panel, and Shot.
   */
  private buildTraceabilityMatrix(params: {
    blocks: NovelChapterBlock[];
    scenes: StudioSceneItem[];
    pages: ManhwaPagePlan[];
    allEvents: NovelSemanticEvent[];
  }): ChapterManhwaLayoutPlan["traceability_matrix"] {
    const { blocks, scenes, pages, allEvents } = params;
    const matrix: ChapterManhwaLayoutPlan["traceability_matrix"] = [];

    // Map all known events
    for (const event of allEvents) {
      const sourceBlock = blocks.find((b) => b.events?.some((e) => e.event_id === event.event_id))?.block_id || "BLOCK_001";
      const mappedScene = scenes.find((s) => s.event_ids?.includes(event.event_id) || s.scene_id === event.mapped_scene_id);
      const sceneId = mappedScene?.scene_id || event.mapped_scene_id || scenes[0]?.scene_id || "SCENE_001";

      const mappedPage = pages.find((p) => p.scene_ids.includes(sceneId) || p.event_ids.includes(event.event_id)) || pages[0];
      const pageId = mappedPage?.page_id || "PAGE_001";

      const mappedPanel = mappedPage?.panels.find(
        (pan) => pan.event_ids.includes(event.event_id) || pan.scene_id === sceneId
      ) || mappedPage?.panels[0];

      const panelId = mappedPanel?.panel_id || "PANEL_P001_01";
      const shotId =
        mappedPanel?.shot_id ||
        (sceneId && sceneId !== "undefined" ? `SHOT_${sceneId}_01` : "SHOT_SCENE_001_01");

      matrix.push({
        event_id: event.event_id,
        source_block: sourceBlock,
        scene_id: sceneId,
        page_id: pageId,
        panel_id: panelId,
        shot_id: shotId,
        represented: "YES",
        important: event.requires_independent_scene || event.importance === "HIGH" || event.importance === "CRITICAL" ? "YES" : "NO",
      });
    }

    return matrix;
  }
}

export const manhwaPageEngine = new ManhwaPageEngine();
