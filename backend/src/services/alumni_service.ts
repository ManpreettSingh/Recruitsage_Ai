import { AlumniLink } from "../models/schemas";

export class AlumniService {
  async findSeniors(company: string, role: string = ""): Promise<AlumniLink[]> {
    const cleanCompany = company.replace(/"/g, "").trim();
    const encodedCompany = encodeURIComponent(cleanCompany);

    const searchQuery = `${cleanCompany} Thapar Institute of Engineering and Technology`;
    const encodedQuery = encodeURIComponent(searchQuery);
    const linkedinSearchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodedQuery}`;
    const schoolPortalUrl = `https://www.linkedin.com/school/thapar-institute-of-engineering-and-technology/people/?keywords=${encodedCompany}`;

    return [
      {
        title: `Thapar Institute Alumni at ${cleanCompany}`,
        name: `All Thapar Alumni at ${cleanCompany}`,
        headline: `Filtered 1-click LinkedIn search for Thapar Institute of Engineering and Technology alumni working at ${cleanCompany}`,
        search_query: searchQuery,
        url: linkedinSearchUrl,
        school_portal_url: schoolPortalUrl,
        is_profile: false,
        source_type: "LinkedIn Search",
        batch_info: "Thapar Institute of Eng. & Tech.",
      },
    ];
  }
}

export const alumniService = new AlumniService();
