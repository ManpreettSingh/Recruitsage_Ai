import urllib.parse
from typing import List, Dict, Any

class AlumniService:
    def __init__(self):
        pass

    async def find_seniors(self, company: str, role: str = "") -> List[Dict[str, Any]]:
        """
        Provides a single direct 1-click LinkedIn Search link:
        Opens LinkedIn people search bar with the target company searched and 
        school filter pre-set to Thapar Institute of Engineering and Technology,
        allowing students to instantly see all alumni working at that company.
        """
        clean_company = company.replace('"', '').strip()
        encoded_company = urllib.parse.quote(clean_company)
        
        # Exact LinkedIn query searched in the search bar: Company + Thapar Institute of Engineering and Technology
        search_query = f"{clean_company} Thapar Institute of Engineering and Technology"
        encoded_query = urllib.parse.quote(search_query)
        linkedin_search_url = f"https://www.linkedin.com/search/results/people/?keywords={encoded_query}"
        
        # Direct school page alumni tab URL for Thapar Institute of Engineering and Technology
        school_portal_url = f"https://www.linkedin.com/school/thapar-institute-of-engineering-and-technology/people/?keywords={encoded_company}"

        return [
            {
                "title": f"Thapar Institute Alumni at {clean_company}",
                "name": f"All Thapar Alumni at {clean_company}",
                "headline": f"Filtered 1-click LinkedIn search for Thapar Institute of Engineering and Technology alumni working at {clean_company}",
                "search_query": search_query,
                "url": linkedin_search_url,
                "school_portal_url": school_portal_url,
                "is_profile": False,
                "source_type": "LinkedIn Search",
                "batch_info": "Thapar Institute of Eng. & Tech."
            }
        ]

alumni_service = AlumniService()
