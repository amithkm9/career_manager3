// app/api/recommendations/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import ModelClient from "@azure-rest/ai-inference";
import { AzureKeyCredential } from "@azure/core-auth";

// Initialize Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Initialize Azure OpenAI client
const azureInferenceEndpoint = process.env.AZURE_INFERENCE_SDK_ENDPOINT || "https://techc-m9gn6hvm-eastus2.services.ai.azure.com/models";
const azureInferenceKey = process.env.AZURE_INFERENCE_SDK_KEY as string;
const deploymentName = process.env.DEPLOYMENT_NAME || "Phi-4";

const client = new ModelClient(
  azureInferenceEndpoint,
  new AzureKeyCredential(azureInferenceKey)
);

// Default recommendations to use as fallback
const defaultRecommendations = [
  {
    "role_title": "Software Developer",
    "description": "Software developers create applications and systems that run on computers and other devices. They design, code, test, and maintain software solutions for various problems and needs.",
    "why_it_fits_professionally": "Your technical skills and problem-solving abilities would make you a strong candidate for software development roles. Your experience with analytical thinking aligns well with the core competencies needed.",
    "why_it_fits_personally": "Your interest in creating solutions and solving complex problems makes software development a fulfilling career path that matches your personal interests."
  },
  {
    "role_title": "Data Analyst",
    "description": "Data analysts examine datasets to identify trends and draw conclusions. They present findings to help organizations make better business decisions.",
    "why_it_fits_professionally": "Your analytical thinking skills and attention to detail would serve you well as a data analyst. This role leverages your abilities to find patterns and insights in complex information.",
    "why_it_fits_personally": "Your curiosity and interest in uncovering insights from information makes data analysis a personally satisfying career that aligns with your values."
  },
  {
    "role_title": "Product Manager",
    "description": "Product managers oversee the development of products from conception to launch. They define product strategy, gather requirements, and coordinate with different teams to ensure successful delivery.",
    "why_it_fits_professionally": "Your combination of technical understanding and strategic planning abilities makes product management a good professional fit. This role utilizes both your analytical and communication skills.",
    "why_it_fits_personally": "Your interest in both the business and technical aspects of products, along with your desire to create meaningful solutions, aligns well with product management."
  }
];

export async function POST(request: NextRequest) {
  try {
    // Get user ID from request body
    const { userId } = await request.json();

    if (!userId) {
      return NextResponse.json(
        { error: "Missing userId in request" },
        { status: 400 }
      );
    }

    // Fetch user profile data from Supabase
    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("discovery_data")
      .eq("id", userId)
      .single();

    if (profileError) {
      console.error("Error fetching profile data:", profileError);
      return NextResponse.json({ recommendations: defaultRecommendations });
    }

    const discoveryData = profileData?.discovery_data;

    // Instead of returning 404, return default recommendations if no discovery data
    if (!discoveryData) {
      console.log("No discovery data for user, returning default recommendations");
      return NextResponse.json({ recommendations: defaultRecommendations });
    }

    // Check if there are existing recommendations for this user
    const { data: existingRecommendations, error: recError } = await supabase
      .from("role_recommendations")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(3);
      
    if (!recError && existingRecommendations && existingRecommendations.length > 0) {
      console.log("Using existing recommendations from database");
      const formattedRecs = existingRecommendations.map(item => ({
        role_title: item.role_title,
        description: item.description,
        why_it_fits_professionally: item.why_it_fits_professionally,
        why_it_fits_personally: item.why_it_fits_personally,
      }));
      return NextResponse.json({ recommendations: formattedRecs });
    }

    // Prepare the prompt for Azure OpenAI - simplified to reduce processing time
    const formattedData = {
      skills: {
        selected: discoveryData.skills.selected || [],
        additional_info: discoveryData.skills.additional_info || ""
      },
      values: {
        selected: discoveryData.values.selected || [],
        additional_info: discoveryData.values.additional_info || ""
      },
      interests: {
        selected: discoveryData.interests.selected || [],
        additional_info: discoveryData.interests.additional_info || ""
      }
    };

    // Create a more concise request for Azure OpenAI
    const messages = [
      {
        role: "system",
        content: `Generate exactly 3 career roles as a JSON array based on the user's profile. Each object should have: role_title, description, why_it_fits_professionally, why_it_fits_personally. Be concise. Format: [{...},{...},{...}].`
      },
      {
        role: "user",
        content: `Skills: ${formattedData.skills.selected.join(", ")}
         Interests: ${formattedData.interests.selected.join(", ")}
         Values: ${formattedData.values.selected.join(", ")}`
      },
    ];

    try {
      // Make the API call to Azure OpenAI with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await client.path("chat/completions").post({
        body: {
          messages: messages,
          max_tokens: 800, // Reduced token count
          model: deploymentName,
          temperature: 0.7, // Added temperature for faster responses
        },
      }, { signal: controller.signal });
      
      clearTimeout(timeoutId);

      if (!response.body) {
        console.error("No response from Azure OpenAI");
        return NextResponse.json({ recommendations: defaultRecommendations });
      }

      // Parse the response
      let roleRecommendations;
      try {
        const responseContent = response.body.choices[0].message.content;
        console.log("Raw response from Azure OpenAI:", responseContent);
        
        // Try to clean the response if it's not valid JSON
        let jsonString = responseContent.trim();
        
        // Sometimes the AI adds markdown code blocks, remove them
        if (jsonString.startsWith("```json")) {
          jsonString = jsonString.replace(/```json\n/, "").replace(/\n```$/, "");
        } else if (jsonString.startsWith("```")) {
          jsonString = jsonString.replace(/```\n/, "").replace(/\n```$/, "");
        }
        
        // Sometimes AI adds explanatory text before or after the JSON
        // Try to extract just the JSON array part
        const jsonArrayMatch = jsonString.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonArrayMatch) {
          jsonString = jsonArrayMatch[0];
        }
        
        roleRecommendations = JSON.parse(jsonString);
        
        // Ensure it's an array
        if (!Array.isArray(roleRecommendations)) {
          if (typeof roleRecommendations === 'object') {
            // If it's an object but not an array, try to convert it to an array
            roleRecommendations = [roleRecommendations];
          } else {
            throw new Error("Response is not an array or object");
          }
        }
      } catch (error) {
        console.error("Error parsing Azure OpenAI response:", error);
        console.error("Response content:", response.body.choices[0].message.content);
        
        // Return fallback recommendations
        roleRecommendations = defaultRecommendations;
      }

      // Save recommendations to database for future use to avoid timeouts
      try {
        for (const rec of roleRecommendations) {
          await supabase.from("role_recommendations").insert({
            user_id: userId,
            role_title: rec.role_title,
            description: rec.description,
            why_it_fits_professionally: rec.why_it_fits_professionally,
            why_it_fits_personally: rec.why_it_fits_personally
          });
        }
      } catch (saveError) {
        console.error("Error saving recommendations to database:", saveError);
        // Continue even if saving fails
      }

      // Return the recommendations
      return NextResponse.json({ recommendations: roleRecommendations });
      
    } catch (apiError) {
      console.error("Error calling Azure OpenAI:", apiError);
      return NextResponse.json({ recommendations: defaultRecommendations });
    }
    
  } catch (error) {
    console.error("Error in API route:", error);
    return NextResponse.json({ recommendations: defaultRecommendations });
  }
}