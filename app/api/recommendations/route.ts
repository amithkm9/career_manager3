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

    // Prepare the prompt for Azure OpenAI
    const formattedData = {
      skills: {
        selected: discoveryData.skills.selected,
        additional_info: discoveryData.skills.additional_info
      },
      values: {
        selected: discoveryData.values.selected,
        additional_info: discoveryData.values.additional_info
      },
      interests: {
        selected: discoveryData.interests.selected,
        additional_info: discoveryData.interests.additional_info
      },
      timestamp: discoveryData.timestamp,
      "Resume Summary": {
        skills: [], // If available, parse from CV 
        projects: [], // If available, parse from CV
        experiences: [], // If available, parse from CV
        education: {} // If available, parse from CV
      }
    };

    // Create the request for Azure OpenAI
    const messages = [
      {
        role: "system",
        content: `You are a career coach and AI expert who helps individuals identify the most suitable career roles for them.
          Your task is to analyze the given information and suggest exactly 3 career roles that best fit the person's profile.
          
          Your output MUST be a valid JSON array with 3 objects representing career recommendations.
          Each object must have exactly these fields: role_title, description, why_it_fits_professionally, why_it_fits_personally.
          The response must be ONLY the JSON array with no other text, no explanation, no formatting marks like \`\`\`.
          
          Here is the exact format:
          [
            {
              "role_title": "First Job Title",
              "description": "Description of first role",
              "why_it_fits_professionally": "Professional fit for first role",
              "why_it_fits_personally": "Personal fit for first role"
            },
            {
              "role_title": "Second Job Title",
              "description": "Description of second role",
              "why_it_fits_professionally": "Professional fit for second role",
              "why_it_fits_personally": "Personal fit for second role"
            },
            {
              "role_title": "Third Job Title",
              "description": "Description of third role",
              "why_it_fits_professionally": "Professional fit for third role",
              "why_it_fits_personally": "Personal fit for third role"
            }
          ]
          
          Important: DO NOT include any text outside the JSON array. The response must be parseable by JSON.parse().`
      },
      {
        role: "user",
        content: `Please analyze this profile and provide exactly 3 career recommendations in JSON format:
          
          Skills: ${JSON.stringify(formattedData.skills)}
          Interests: ${JSON.stringify(formattedData.interests)}
          Values: ${JSON.stringify(formattedData.values)}
          
          Remember, I need ONLY the JSON array with 3 career recommendations, nothing else.`
      },
    ];

    try {
      // Make the API call to Azure OpenAI
      const response = await client.path("chat/completions").post({
        body: {
          messages: messages,
          max_tokens: 1500,
          model: deploymentName,
        },
      });

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